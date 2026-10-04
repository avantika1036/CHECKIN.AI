"""Stage 4: the web API (FastAPI). Thin on purpose - every decision lives in the modules below it.

Auth: log in once, get a signed token (JWT), send it as `Authorization: Bearer <token>`.
The token carries the user's organisation (tenant) and role, so every query is scoped to it.
"""
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from langgraph.checkpoint.postgres import PostgresSaver
from pydantic import BaseModel, Field, model_validator

from . import audit, commit
from .db import make_pool, migrate
from .graph import build_graph, resume_run, run_state, start_run
from .llm.gemini import GeminiProvider
from .security import create_token, decode_token, hash_password, verify_password
from .settings import get_settings
from .verify import load_config

_DUMMY_HASH = hash_password("not-a-real-password")      # so unknown usernames cost the same time as wrong passwords
_UNSET = object()


class LoginIn(BaseModel):
    username: str
    password: str


class RunIn(BaseModel):
    text: str | None = Field(default=None, max_length=600)
    fields: dict | None = None                           # present => plain form (no AI)

    @model_validator(mode="after")
    def _has_input(self):
        if not (self.text and self.text.strip()) and not self.fields:
            raise ValueError("send either non-empty 'text' or non-empty 'fields'")
        return self


class AnswerIn(BaseModel):
    action: Literal["confirm", "edit", "add_text", "cancel"]
    fields: dict | None = None
    host_id: str | None = None
    link_visitor_id: str | None = None
    text: str | None = Field(default=None, max_length=600)
    visit_id: str | None = None


class DecisionIn(BaseModel):
    approve: bool


def default_provider():
    s = get_settings()
    if s.llm_provider == "gemini" and s.gemini_api_key:
        return GeminiProvider(s.gemini_api_key, s.gemini_model, s.llm_timeout_seconds)
    return None                                          # no key -> every sentence falls back to the plain form


def create_app(provider=_UNSET, clock=None) -> FastAPI:
    settings = get_settings()
    ai_configured = (default_provider() is not None) if provider is _UNSET else provider is not None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        pool, cp_pool = make_pool(), make_pool(autocommit=True)
        pool.open(); cp_pool.open()
        migrate(pool)
        saver = PostgresSaver(cp_pool)
        saver.setup()
        app.state.pool = pool
        kwargs = {"clock": clock} if clock else {}
        app.state.graph = build_graph(pool, saver, default_provider() if provider is _UNSET else provider,
                                      settings, **kwargs)
        yield
        pool.close(); cp_pool.close()

    app = FastAPI(title="checkIn.ai", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","),
                       allow_methods=["*"], allow_headers=["*"])

    # ------------------------------------------------------------- auth helpers
    def current_user(authorization: str = Header(default="")) -> dict:
        if not authorization.startswith("Bearer "):
            raise HTTPException(401, "missing token")
        try:
            claims = decode_token(authorization[7:])
        except jwt.InvalidTokenError:
            raise HTTPException(401, "invalid or expired token")
        return {"username": claims["sub"], "tenant": claims["tenant"], "role": claims["role"]}

    def admin_only(user: dict = Depends(current_user)) -> dict:
        if user["role"] != "admin":
            raise HTTPException(403, "admin only")
        return user

    def own_run(run_id: str, user: dict) -> dict:
        state = run_state(app.state.graph, run_id)
        if state["tenant_id"] != user["tenant"]:         # also covers 'no such run' -> same 404, no leaking
            raise HTTPException(404, "no such run")
        return state

    def public(state: dict) -> dict:
        return {k: v for k, v in state.items() if k != "tenant_id"}

    # ------------------------------------------------------------- endpoints
    @app.get("/api/health")
    def health():
        with app.state.pool.connection() as c:
            c.execute("SELECT 1")
        return {"ok": True, "ai_configured": ai_configured}

    @app.post("/api/auth/login")
    def login(body: LoginIn):
        with app.state.pool.connection() as c:
            u = c.execute("SELECT username, password_hash, role, tenant_id FROM users WHERE username = %s",
                          (body.username,)).fetchone()
            ok = verify_password(body.password, u["password_hash"] if u else _DUMMY_HASH)
            if not (u and ok):
                raise HTTPException(401, "wrong username or password")
            cfg, _ = load_config(c, u["tenant_id"])
        return {"token": create_token(u["username"], u["tenant_id"], u["role"]), "role": u["role"],
                "tenant": u["tenant_id"], "display_name": cfg.display_name, "host_label": cfg.host_label,
                "username": u["username"]}

    @app.get("/api/me")
    def me(user: dict = Depends(current_user)):
        return user

    @app.post("/api/runs")
    def new_run(body: RunIn, user: dict = Depends(current_user)):
        if not (body.text or body.fields):
            raise HTTPException(422, "send either 'text' or 'fields'")
        initial = {"tenant_id": user["tenant"], "actor": user["username"]}
        if body.fields is not None:
            initial.update(mode="form", fields=body.fields)
        else:
            initial.update(mode="text", text=body.text.strip())
        return public(start_run(app.state.graph, str(uuid.uuid4()), initial))

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str, user: dict = Depends(current_user)):
        return public(own_run(run_id, user))

    @app.post("/api/runs/{run_id}/answer")
    def answer(run_id: str, body: AnswerIn, user: dict = Depends(current_user)):
        own_run(run_id, user)
        return public(resume_run(app.state.graph, run_id, body.model_dump(exclude_none=True)))

    @app.get("/api/hosts")
    def hosts(user: dict = Depends(current_user)):
        with app.state.pool.connection() as c:
            return c.execute("SELECT id::text AS id, name, department FROM hosts "
                             "WHERE tenant_id = %s AND active ORDER BY name", (user["tenant"],)).fetchall()

    @app.get("/api/visits")
    def visits(status: str | None = None, limit: int = Query(50, le=200), user: dict = Depends(current_user)):
        with app.state.pool.connection() as c:
            return c.execute(
                "SELECT vi.id::text AS id, v.name AS visitor, v.phone, h.name AS host, vi.purpose, vi.status, "
                "vi.arrived_at, vi.checked_out_at, vi.warnings FROM visits vi "
                "JOIN visitors v ON v.id = vi.visitor_id JOIN hosts h ON h.id = vi.host_id "
                "WHERE vi.tenant_id = %s AND (%s::text IS NULL OR vi.status = %s) "
                "ORDER BY vi.arrived_at DESC LIMIT %s", (user["tenant"], status, status, limit)).fetchall()

    @app.post("/api/visits/{visit_id}/decision")
    def decision(visit_id: str, body: DecisionIn, user: dict = Depends(admin_only)):
        try:
            return commit.decide_visit(app.state.pool, tenant_id=user["tenant"], actor=user["username"],
                                       visit_id=visit_id, approve=body.approve)
        except commit.CommitRefused as e:
            raise HTTPException(409, str(e))

    @app.post("/api/visits/autoclose")
    def autoclose(user: dict = Depends(admin_only)):
        return commit.autoclose_open_visits(app.state.pool, tenant_id=user["tenant"], actor=user["username"])

    @app.get("/api/audit")
    def audit_list(limit: int = Query(100, le=500), user: dict = Depends(admin_only)):
        with app.state.pool.connection() as c:
            return c.execute("SELECT seq, ts, actor, event_type, payload, hash FROM audit_log "
                             "WHERE tenant_id = %s ORDER BY seq DESC LIMIT %s", (user["tenant"], limit)).fetchall()

    @app.get("/api/audit/verify")
    def audit_verify(user: dict = Depends(admin_only)):
        with app.state.pool.connection() as c:
            return audit.verify_chain(c, user["tenant"])

    @app.get("/api/notifications")
    def notifications(user: dict = Depends(admin_only)):
        with app.state.pool.connection() as c:
            return c.execute("SELECT recipient, body, channel, status, created_at FROM notifications "
                             "WHERE tenant_id = %s ORDER BY created_at DESC LIMIT 50", (user["tenant"],)).fetchall()

    return app


def app_factory() -> FastAPI:                            # uvicorn app.main:app_factory --factory
    return create_app()
