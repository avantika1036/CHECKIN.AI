# ASR provider benchmark

This folder is independent of the backend application. It compares the same
recording with the browser Web Speech API, local Whisper, and Sarvam AI.

## Setup

From this folder:

```powershell
C:\SETUP\python.exe -m pip install -r requirements.txt
```

Additional requirements:

- Whisper requires `ffmpeg`.
- Sarvam requires `SARVAM_API_KEY`.

The web interface lets you select Whisper `tiny`, `base`, `small`, `medium`,
and `large` independently. Each selected model appears as a separate result.
The larger models require substantially more disk space, memory, and processing
time.

## Manifest

Create `data/asr_manifest.jsonl` with one row per labelled recording:

```json
{"id":"en-001","audio":"audio/en-001.wav","reference":"Rahul Sharma is here","language":"en-IN","split":"test"}
```

Audio paths are resolved relative to the manifest file.

## Run

```powershell
cd C:\Work\CHECKIN.AI\asr_benchmark
C:\SETUP\python.exe asr_benchmark.py `
  --manifest data/asr_manifest.jsonl `
  --provider whisper sarvam `
  --output-dir reports
```

The generated files are:

- `reports/asr_report.json`
- `reports/asr_results.csv`
- `reports/asr_report.md`

The report includes WER, CER, exact-match rate, substitutions,
insertions, deletions, latency, real-time factor, provider errors, and
language-level summaries.

## Robust test suite and final report

Generate a 20-case labelled suite covering clean speech, names, phone numbers,
visit purposes, mixed-language speech, noise, and accents:

```powershell
C:\SETUP\python.exe create_test_manifest.py
```

This creates `data/asr_manifest.jsonl`. Record the matching audio files under
`data/audio/`. Keep the reference text exactly equal to the words spoken.
The complete set of sentences to speak is in
`data/speech_test_cases.md`.

Run the structured evaluation:

```powershell
C:\SETUP\python.exe run_evaluation.py `
  --manifest data/asr_manifest.jsonl `
  --whisper-model tiny base small medium large `
  --output-dir reports/final
```

The final output contains:

- `final_report.md` and `evaluation_report.json`
- Per-case `asr_results.csv`
- Summaries by language, scenario, and difficulty
- `wer_by_provider.png`
- `cer_by_provider.png`
- `latency_by_provider.png`
- `exact_match_by_provider.png`

The browser Web Speech result can be entered as an additional transcript in
the CSV for comparison, but the repeatable batch runner evaluates recorded
audio providers. Use the same speakers, sentences, and recordings for every
provider.

## Test

```powershell
cd C:\Work\CHECKIN.AI
C:\SETUP\python.exe -m pytest -q asr_benchmark/test_asr_benchmark.py
```

## Browser recorder

Set the Sarvam key only in the terminal, then start the local interface:

```powershell
cd C:\Work\CHECKIN.AI\asr_benchmark
$env:SARVAM_API_KEY = "<YOUR_SARVAM_API_KEY>"
C:\SETUP\python.exe web_app.py
```

Open `http://127.0.0.1:8765`, choose a language, enter the reference
transcript, record, and click **Benchmark recording**. The key stays on the
Python server and is never sent to the browser. Stop the server with `Ctrl+C`.

Each benchmark is automatically saved under `runs/` with its case ID, audio,
reference text, provider transcripts, WER, CER, exact-match result, and latency.
Use **Next case** to continue through the selected language. After completing
the cases, click **Generate final report**. The server writes
`runs/final_report.md`, `runs/final_report.json`, and WER/CER/latency PNG graphs.

Whisper models are cached while `web_app.py` is running. The first case using
each model is slower because the model may download and load; later cases reuse
the loaded model. Select only the models needed for a practical session because
keeping `medium` and `large` loaded requires substantial memory.
