from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from app.llm.fake import FakeProvider
from app.main import create_app
from app.settings import get_settings

IST = ZoneInfo("Asia/Kolkata")
SENT = "Rahul Sharma, 98765 43210, here to meet Naveen Aggarwal for a project discussion"
GOOD = {"intent": "register_visitor",
        "name": {"value": "Rahul Sharma", "evidence": "Rahul Sharma"},
        "phone": {"value": "9876543210", "evidence": "98765 43210"},
        "host": {"value": "Naveen Aggarwal", "evidence": "Naveen Aggarwal"},
        "purpose": {"value": "project discussion", "evidence": "a project discussion"}}
PW = get_settings().seed_password


@pytest.fixture()
def client(seeded):
    app = create_app(provider=FakeProvider(lambda user: GOOD), clock=lambda: datetime(2026, 10, 5, 11, 0, tzinfo=IST))
    with TestClient(app) as c:
        yield c


def login(client, user):
    r = client.post("/api/auth/login", json={"username": user, "password": PW})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_health_needs_no_login(client):
    assert client.get("/api/health").json()["ok"] is True


def test_login_failures_look_identical(client):
    a = client.post("/api/auth/login", json={"username": "guard_uiet", "password": "wrong"})
    b = client.post("/api/auth/login", json={"username": "nobody", "password": "wrong"})
    assert a.status_code == b.status_code == 401 and a.json() == b.json()


def test_endpoints_require_a_valid_token(client):
    assert client.get("/api/visits").status_code == 401
    assert client.get("/api/visits", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_full_register_flow_over_http(client):
    h = login(client, "guard_uiet")
    r = client.post("/api/runs", json={"text": SENT}, headers=h).json()
    assert r["status"] == "awaiting" and r["card"]["outcome"] == "pass" and "tenant_id" not in r
    done = client.post(f"/api/runs/{r['run_id']}/answer", json={"action": "confirm"}, headers=h).json()
    assert done["result"]["status"] == "registered"
    again = client.post(f"/api/runs/{r['run_id']}/answer", json={"action": "confirm"}, headers=h).json()
    assert again["result"] == done["result"]                       # double tap is harmless
    visits = client.get("/api/visits", headers=h).json()
    assert len(visits) == 1 and visits[0]["visitor"] == "Rahul Sharma" and visits[0]["host"] == "Dr. Naveen Aggarwal"


def test_plain_form_over_http(client):
    h = login(client, "guard_uiet")
    f = {"name": "Asha", "phone": "9123456789", "host": "Sunita Verma", "purpose": "admission query"}
    r = client.post("/api/runs", json={"fields": f}, headers=h).json()
    assert r["card"]["outcome"] == "pass"
    assert client.post(f"/api/runs/{r['run_id']}/answer", json={"action": "confirm"}, headers=h
                       ).json()["result"]["status"] == "registered"


def test_guards_cannot_use_admin_endpoints(client):
    h = login(client, "guard_uiet")
    for method, url in (("get", "/api/audit"), ("get", "/api/audit/verify"), ("post", "/api/visits/autoclose"),
                        ("get", "/api/notifications")):
        assert getattr(client, method)(url, headers=h).status_code == 403


def test_other_organisation_cannot_see_or_answer_my_run(client):
    mine, theirs = login(client, "guard_uiet"), login(client, "guard_greenview")
    run = client.post("/api/runs", json={"text": SENT}, headers=mine).json()["run_id"]
    assert client.get(f"/api/runs/{run}", headers=theirs).status_code == 404
    assert client.post(f"/api/runs/{run}/answer", json={"action": "confirm"}, headers=theirs).status_code == 404
    assert client.get(f"/api/runs/{uuid_like()}", headers=mine).status_code == 404


def uuid_like():
    return "11111111-1111-1111-1111-111111111111"


def test_admin_approval_audit_and_verification(client):
    g, a = login(client, "guard_uiet"), login(client, "admin_uiet")
    f = {"name": "Vikram", "phone": "9123456780", "host": "Harpreet", "purpose": "vendor demo"}   # vendor -> approval
    run = client.post("/api/runs", json={"fields": f}, headers=g).json()
    res = client.post(f"/api/runs/{run['run_id']}/answer", json={"action": "confirm"}, headers=g).json()["result"]
    assert res["visit_status"] == "pending_approval"
    assert client.post(f"/api/visits/{res['visit_id']}/decision", json={"approve": True}, headers=g).status_code == 403
    assert client.post(f"/api/visits/{res['visit_id']}/decision", json={"approve": True}, headers=a
                       ).json()["status"] == "checked_in"
    assert client.post(f"/api/visits/{res['visit_id']}/decision", json={"approve": True}, headers=a).status_code == 409
    assert client.get("/api/audit/verify", headers=a).json()["ok"] is True
    events = [e["event_type"] for e in client.get("/api/audit", headers=a).json()]
    assert "visit.approved" in events and "visit.registered" in events
    assert len(client.get("/api/notifications", headers=a).json()) == 1


def test_without_a_model_the_api_still_works_via_the_form(seeded):
    with TestClient(create_app(provider=None)) as c:
        h = login(c, "guard_uiet")
        r = c.post("/api/runs", json={"text": SENT}, headers=h).json()
        assert r["result"]["status"] == "manual_needed" and r["result"]["prefill"]["phone"] == "+919876543210"
        assert c.get("/api/health").json()["ai_configured"] is False


def test_input_validation(client):
    h = login(client, "guard_uiet")
    assert client.post("/api/runs", json={}, headers=h).status_code == 422
    assert client.post("/api/runs", json={"text": "x" * 601}, headers=h).status_code == 422


def test_swagger_shows_an_authorize_button(client):
    """/docs only offers the 'Authorize' lock if the API declares a bearer-token security scheme."""
    spec = client.get("/openapi.json").json()
    schemes = spec["components"]["securitySchemes"]
    assert any(v.get("type") == "http" and v.get("scheme") == "bearer" for v in schemes.values())
    assert spec["paths"]["/api/runs"]["post"]["security"]               # protected endpoint is marked
    assert "security" not in spec["paths"]["/api/health"]["get"]        # public one is not
    # and the token is NOT a per-request text field any more
    names = [p["name"] for p in spec["paths"]["/api/visits"]["get"].get("parameters", [])]
    assert "authorization" not in names


def test_auto_seed_creates_demo_users_on_startup(clean, monkeypatch):
    monkeypatch.setenv("AUTO_SEED", "true")
    get_settings.cache_clear()
    try:
        with TestClient(create_app(provider=None)) as c:
            assert c.post("/api/auth/login", json={"username": "admin_greenview", "password": PW}).status_code == 200
    finally:
        monkeypatch.delenv("AUTO_SEED")
        get_settings.cache_clear()


def test_failover_works_end_to_end_over_http(seeded):
    """Primary model answers 503; the backup answers; the guard still gets a normal review card."""
    import json as _json

    import httpx

    from app.llm.chain import ChainProvider
    from app.llm.openai_compat import groq_provider

    def down(request):
        return httpx.Response(503, json={"error": {"message": "overloaded"}})

    def up(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": _json.dumps(GOOD)}}],
                                         "usage": {"total_tokens": 700}})

    primary = groq_provider("k", "model-a", transport=httpx.MockTransport(down))
    backup = groq_provider("k", "model-b", transport=httpx.MockTransport(up))
    chain = ChainProvider([primary, backup], cooldown_seconds=30)
    app = create_app(provider=chain, clock=lambda: datetime(2026, 10, 5, 11, 0, tzinfo=IST))
    with TestClient(app) as c:
        assert c.get("/api/health").json()["ai_configured"] is True
        h = login(c, "guard_uiet")
        r = c.post("/api/runs", json={"text": SENT}, headers=h).json()
        assert r["status"] == "awaiting" and r["card"]["outcome"] == "pass"
        assert [t for t in r["trace"] if t["step"] == "understand"][0]["model"] == "groq:model-b"   # the backup answered
        again = c.post("/api/runs", json={"text": SENT}, headers=h).json()                           # primary is skipped now
        assert again["status"] == "awaiting" and chain.total_tokens == 1400
