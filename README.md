# checkIn.ai

Say or type one sentence; the system turns it into a checked, saved, audited visitor record.
**The AI proposes, plain code decides.** The full step-by-step guide is in `docs/`.

## Run everything with one command (Docker)
    cp .env.example .env        # (Windows: copy .env.example .env) then put your Gemini key in .env
    docker compose up --build   # database + backend + frontend; demo data is loaded automatically
    # open http://localhost:5173   -> log in: guard_uiet / admin_uiet / guard_greenview / admin_greenview
    #                                  password: changeme123
    # API test page: http://localhost:8000/docs   (click Authorize, paste the token from /api/auth/login)

## Or run with two terminals (database in Docker)
    docker compose up -d db
    # Terminal 1 (backend):  cd backend && python -m venv .venv && activate it && pip install -r requirements.txt
    #                        python -m app.seed && uvicorn app.main:app_factory --factory --reload --port 8000
    # Terminal 2 (frontend): cd frontend && npm install && npm run dev

## Tests (create the test database once: docker compose exec db psql -U postgres -c "CREATE DATABASE checkin_test;")
    cd backend && python -m pytest -q        # 148 tests
    cd frontend && npm test
