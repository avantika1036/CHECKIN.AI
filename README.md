# checkIn.ai

Say or type one sentence; the system turns it into a checked, saved, audited visitor record.
**The AI proposes, plain code decides.** See `docs/` for the implementation guide.

## Run it (Docker)
    cp .env.example .env        # then put your Gemini key in .env
    docker compose up --build
    docker compose exec backend python -m app.seed
    # open http://localhost:5173   (guard_uiet / admin_uiet / guard_greenview / admin_greenview, password: changeme123)

## Run the tests (needs Postgres with a database named checkin_test)
    cd backend && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
    python -m pytest -q
    cd ../frontend && npm install && npm test
