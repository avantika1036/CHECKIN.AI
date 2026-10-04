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

## Compare speech-to-text providers

The optional benchmark in `asr_benchmark/` compares the same labelled
recordings with local Whisper and Sarvam AI. It reports WER, CER,
exact-match rate, latency, real-time factor, provider errors, and language-level breakdowns.
Create a JSONL manifest as described in `asr_benchmark/README.md`, install only the
providers you need, then run:

    cd asr_benchmark
    pip install -r requirements.txt
    python asr_benchmark.py --manifest data/asr_manifest.jsonl \
      --provider whisper sarvam --output-dir reports

Whisper requires `ffmpeg`; Sarvam requires `SARVAM_API_KEY`. Provider credentials and
generated reports are not committed.

## Repository mirror

The `backend-partial-frontend` branch is also maintained in the mirror repository:
https://github.com/avantika1036/CHECKIN.AI

See [docs/repository-mirror.md](docs/repository-mirror.md) for the branch sync commands.
