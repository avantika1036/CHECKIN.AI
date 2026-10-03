"""Stage 3: the LangGraph pipeline - the flowchart a sentence travels through.

    understand -> verify -> confirm (PAUSES for the guard) -> commit -> END
                     ^           |
                     +-- edit ---+          checkout:  find -> confirm_checkout (PAUSES) -> END

Why LangGraph: `interrupt()` pauses the run and saves its whole state in Postgres, so the guard can
answer seconds or minutes later (even after a server restart); the same run then resumes exactly
where it stopped. We keep the nodes small; all real decisions live in the plain-code modules.

LangGraph detail worth knowing: when a paused node resumes it re-runs from its first line, so code
placed before `interrupt()` must be free of side effects. Ours only computes.
"""
import operator
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Callable, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from . import audit, commit, directory
from .grounding import check
from .llm.base import LLMError
from .settings import Settings
from .textnorm import find_phones, normalize_phone
from .understanding import Intent, understand
from .verify import authorize, clean_fields

UNCLEAR_MSG = ("I could not tell what you want. Try: 'Name, phone, here to meet Dr X about Y' "
               "or 'Name has left'.")


class State(TypedDict, total=False):
    tenant_id: str
    actor: str
    run_id: str
    mode: str                       # "text" | "form"
    text: str | None                # the guard's sentence (all rounds joined, for the audit)
    followup_text: str | None       # extra sentence added while the card is open
    intent: str
    fields: dict
    checks: dict
    host_id: str | None
    link_visitor_id: str | None
    report: dict
    card: dict
    card_at: str
    rounds: int
    result: dict
    trace: Annotated[list, operator.add]


def build_graph(pool, checkpointer, provider, settings: Settings,
                clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):

    def ev(step: str, t0: float, **summary) -> dict:
        return {"step": step, "ms": round((time.perf_counter() - t0) * 1000), **summary}

    # ---------------------------------------------------------------- understand
    def understand_node(state: State) -> Command[Literal["verify", "__end__"]]:
        t0 = time.perf_counter()
        followup = state.get("followup_text")
        if state.get("mode") == "form":                       # plain form: no AI involved
            fields = clean_fields(state.get("fields") or {})
            return Command(goto="verify", update={
                "intent": Intent.register_visitor.value, "fields": fields,
                "checks": {}, "trace": [ev("form", t0, note="manual entry, no AI used")]})

        text = followup or state["text"]
        previous = state.get("fields") if followup else None
        try:
            if provider is None:
                raise LLMError("no language model configured")
            u = understand(provider, text, now=clock(), previous=previous,
                           max_attempts=settings.llm_max_attempts)
        except LLMError as e:
            prefill = {"phone": (find_phones(text) or [None])[0]}
            return Command(goto=END, update={
                "result": {"status": "manual_needed", "prefill": prefill,
                           "message": "The AI is unavailable - please use the form."},
                "trace": [ev("understand", t0, ok=False, error=str(e)[:160])]})

        checked = check(u, text)
        intent = state.get("intent") if followup else u.intent.value
        if intent == Intent.unknown.value:
            return Command(goto=END, update={
                "intent": intent, "result": {"status": "unclear", "message": UNCLEAR_MSG},
                "trace": [ev("understand", t0, ok=True, intent=intent)]})

        fields, checks = dict(state.get("fields") or {}), dict(state.get("checks") or {})
        for f, value in checked.fields.items():               # new information overrides old
            if value is not None or not followup:
                fields[f], checks[f] = value, checked.checks[f]
        joined = f"{state.get('text') or ''} | {followup}" if followup else text
        return Command(goto="verify", update={
            "intent": intent, "fields": fields, "checks": checks, "text": joined, "followup_text": None,
            "trace": [ev("understand", t0, ok=True, intent=intent, model=provider.name,
                         flagged=checked.flagged)]})

    # ---------------------------------------------------------------- verify
    def verify_node(state: State) -> Command[Literal["confirm", "confirm_checkout", "__end__"]]:
        t0 = time.perf_counter()
        tenant, fields = state["tenant_id"], state["fields"]
        if state["intent"] == Intent.checkout_visitor.value:
            return Command(goto="confirm_checkout", update={})

        with pool.connection() as conn:
            report, ctx = authorize(conn, tenant, fields, state.get("host_id"), clock())
            if report.outcome == "block":
                audit.append(conn, tenant, state["actor"], "proposal.blocked", {
                    "fields": ctx["fields"], "reasons": [r.message for r in report.failures],
                    "run_id": state["run_id"]})
        host_id = state.get("host_id") or (ctx["host"]["id"] if ctx["host_status"] == "resolved" else None)
        link = state.get("link_visitor_id") or (ctx["returning_visitor"]["id"] if ctx["returning_visitor"] else None)
        host = ctx["host"]
        summary = (f"Register {ctx['fields']['name'] or '(no name)'} to meet "
                   f"{host['name'] if host else (ctx['fields']['host'] or '(nobody yet)')}?")
        card = {
            "kind": "register", "summary": summary, "text": state.get("text"),
            "fields": ctx["fields"], "checks": state.get("checks") or {},
            "outcome": report.outcome, "can_confirm": report.can_commit,
            "missing": report.missing_fields,
            "messages": [{"rule_id": r.rule_id, "severity": r.severity, "message": r.message}
                         for r in report.failures],
            "host": host, "host_status": ctx["host_status"], "host_candidates": ctx["host_candidates"],
            "host_label": ctx["host_label"], "returning_visitor": ctx["returning_visitor"],
            "similar_visitors": ctx["similar_visitors"], "link_visitor_id": link,
            "rounds": state.get("rounds", 0)}
        return Command(goto="confirm", update={
            "report": report.model_dump(), "host_id": host_id, "link_visitor_id": link, "card": card,
            "card_at": clock().isoformat(),
            "trace": [ev("verify", t0, outcome=report.outcome, host_status=ctx["host_status"],
                         failed=[r.rule_id for r in report.failures], missing=report.missing_fields)]})

    # ---------------------------------------------------------------- confirm (pauses here)
    def _expired(state: State) -> bool:
        return clock() - datetime.fromisoformat(state["card_at"]) > timedelta(minutes=settings.pending_expiry_minutes)

    def _end(state: State, event: str, status: str, message: str, t0: float) -> Command:
        with pool.connection() as conn:
            audit.append(conn, state["tenant_id"], state["actor"], event,
                         {"run_id": state["run_id"], "fields": state.get("fields")})
        return Command(goto=END, update={"result": {"status": status, "message": message},
                                         "trace": [ev(event, t0)]})

    def confirm_node(state: State) -> Command[Literal["verify", "understand", "commit", "confirm", "__end__"]]:
        t0 = time.perf_counter()
        answer = interrupt(state["card"])                      # <- the run stops here until resumed
        if _expired(state):
            return _end(state, "run.expired", "expired", "This request timed out. Please start again.", t0)
        action = (answer or {}).get("action")
        if action == "cancel":
            return _end(state, "run.cancelled", "cancelled", "Cancelled. Nothing was saved.", t0)
        if action == "confirm":
            if state["report"]["outcome"] in ("pass", "warn", "needs_approval") and state.get("host_id"):
                return Command(goto="commit")
            return Command(goto="confirm", update={"trace": [ev("confirm", t0, note="cannot confirm yet")]})
        rounds = state.get("rounds", 0) + 1
        if rounds > settings.max_edit_rounds:
            return Command(goto=END, update={
                "result": {"status": "too_many_edits", "message": "Too many changes - please use the form.",
                           "prefill": state["card"]["fields"]}, "trace": [ev("confirm", t0, note="edit limit")]})
        if action == "add_text" and (answer.get("text") or "").strip():
            return Command(goto="understand", update={"followup_text": answer["text"].strip(), "rounds": rounds})
        if action == "edit":
            fields = dict(state["fields"])
            edits = answer.get("fields") or {}
            fields.update({k: v for k, v in edits.items() if k in ("name", "phone", "host", "purpose")})
            host_id = answer.get("host_id") or (None if "host" in edits else state.get("host_id"))
            return Command(goto="verify", update={
                "fields": fields, "host_id": host_id, "rounds": rounds,
                "link_visitor_id": answer.get("link_visitor_id", state.get("link_visitor_id")),
                "checks": {k: v for k, v in (state.get("checks") or {}).items() if k not in edits}})
        return Command(goto="confirm", update={"trace": [ev("confirm", t0, note="unrecognised answer")]})

    # ---------------------------------------------------------------- commit
    def commit_node(state: State) -> Command[Literal["__end__"]]:
        t0 = time.perf_counter()
        try:
            out = commit.commit_registration(
                pool, tenant_id=state["tenant_id"], actor=state["actor"], fields=state["fields"],
                host_id=state["host_id"], idempotency_key=state["run_id"],
                link_visitor_id=state.get("link_visitor_id"), raw_text=state.get("text"), now=clock())
        except commit.CommitRefused as e:
            return Command(goto=END, update={
                "result": {"status": "refused", "message": str(e), "reasons": e.messages},
                "trace": [ev("commit", t0, ok=False, outcome=e.outcome)]})
        msg = ("Registered. Waiting for admin approval." if out["status"] == "pending_approval"
               else "Registered and checked in.")
        return Command(goto=END, update={
            "result": {"status": "registered", "visit_status": out["status"], "visit_id": out["visit_id"],
                       "message": msg}, "trace": [ev("commit", t0, ok=True, visit_status=out["status"])]})

    # ---------------------------------------------------------------- check-out
    def confirm_checkout_node(state: State) -> Command[Literal["confirm_checkout", "__end__"]]:
        t0 = time.perf_counter()
        fields = clean_fields(state["fields"])
        phone = fields["phone"] if (fields["phone"] or "").startswith("+91") else normalize_phone(fields["phone"])
        with pool.connection() as conn:
            options = directory.open_visits_matching(conn, state["tenant_id"], fields["name"], phone)
        options = [{**o, "arrived_at": o["arrived_at"].isoformat()} for o in options]
        if not options:
            return Command(goto=END, update={
                "result": {"status": "not_found", "message": "No checked-in visitor matches that."},
                "trace": [ev("find_open_visits", t0, found=0)]})
        card = {"kind": "checkout", "options": options, "fields": fields,
                "summary": f"Check out {options[0]['name']}?" if len(options) == 1
                           else "Which visitor is leaving?"}
        answer = interrupt(card)
        action = (answer or {}).get("action")
        if action == "cancel":
            return Command(goto=END, update={"result": {"status": "cancelled", "message": "Cancelled."}})
        chosen = (answer or {}).get("visit_id") or (options[0]["id"] if len(options) == 1 else None)
        if action != "confirm" or chosen not in {o["id"] for o in options}:
            return Command(goto="confirm_checkout")
        try:
            commit.commit_checkout(pool, tenant_id=state["tenant_id"], actor=state["actor"], visit_id=chosen)
        except commit.CommitRefused as e:
            return Command(goto=END, update={"result": {"status": "refused", "message": str(e)}})
        return Command(goto=END, update={
            "result": {"status": "checked_out", "visit_id": chosen, "message": "Checked out."},
            "trace": [ev("checkout", t0, ok=True)]})

    g = StateGraph(State)
    g.add_node("understand", understand_node)
    g.add_node("verify", verify_node)
    g.add_node("confirm", confirm_node)
    g.add_node("commit", commit_node)
    g.add_node("confirm_checkout", confirm_checkout_node)
    g.add_edge(START, "understand")
    return g.compile(checkpointer=checkpointer)


# ------------------------------------------------------------------ helpers used by the API and the tests
def run_state(graph, run_id: str) -> dict[str, Any]:
    """Describe where a run is: paused with a card, or finished with a result."""
    snap = graph.get_state({"configurable": {"thread_id": run_id}})
    values = snap.values or {}
    interrupts = [i for t in snap.tasks for i in t.interrupts]
    base = {"run_id": run_id, "trace": values.get("trace", []), "tenant_id": values.get("tenant_id")}
    if interrupts:
        return {**base, "status": "awaiting", "card": interrupts[0].value}
    return {**base, "status": "done", "result": values.get("result")}


def start_run(graph, run_id: str, initial: dict) -> dict:
    graph.invoke({"run_id": run_id, "rounds": 0, "trace": [], **initial},
                 {"configurable": {"thread_id": run_id}})
    return run_state(graph, run_id)


def resume_run(graph, run_id: str, answer: dict) -> dict:
    if run_state(graph, run_id)["status"] == "done":          # double-tap / stale screen: just report
        return run_state(graph, run_id)
    graph.invoke(Command(resume=answer), {"configurable": {"thread_id": run_id}})
    return run_state(graph, run_id)
