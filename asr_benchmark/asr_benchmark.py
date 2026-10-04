"""Compare speech-to-text providers on the same labelled audio set.

Manifest format (JSON Lines):
    {"id": "en-001", "audio": "audio/en-001.wav",
     "reference": "Rahul Sharma is here", "language": "en-IN", "split": "test"}

The script intentionally keeps providers optional. A missing SDK, credential, or provider
failure is recorded in the report for that provider instead of hiding the failure or
stopping the whole comparison.

Examples:
    python asr_benchmark.py --manifest data/asr_manifest.jsonl \
        --provider whisper sarvam --output-dir reports
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave
from dataclasses import dataclass
from threading import Lock
from pathlib import Path
from typing import Protocol


DEFAULT_SARVAM_URL = "https://api.sarvam.ai/speech-to-text"
_WHISPER_CACHE: dict[str, object] = {}
_WHISPER_CACHE_LOCK = Lock()


class Provider(Protocol):
    name: str

    def transcribe(self, audio: Path, language: str) -> str:
        ...


@dataclass(frozen=True)
class Case:
    case_id: str
    audio: Path
    reference: str
    language: str
    split: str = "test"
    scenario: str = "unspecified"
    difficulty: str = "unspecified"


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).casefold()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def _edit_distance(reference: list[str], hypothesis: list[str]) -> tuple[int, int, int, int]:
    rows = len(reference) + 1
    cols = len(hypothesis) + 1
    distance = [[0] * cols for _ in range(rows)]
    substitutions = [[0] * cols for _ in range(rows)]
    insertions = [[0] * cols for _ in range(rows)]
    deletions = [[0] * cols for _ in range(rows)]
    for i in range(rows):
        distance[i][0] = i
        deletions[i][0] = i
    for j in range(cols):
        distance[0][j] = j
        insertions[0][j] = j
    for i in range(1, rows):
        for j in range(1, cols):
            if reference[i - 1] == hypothesis[j - 1]:
                distance[i][j] = distance[i - 1][j - 1]
                substitutions[i][j] = substitutions[i - 1][j - 1]
                insertions[i][j] = insertions[i - 1][j - 1]
                deletions[i][j] = deletions[i - 1][j - 1]
                continue
            choices = [
                (distance[i - 1][j - 1] + 1, 1, 0, 0, "sub"),
                (distance[i][j - 1] + 1, 0, 1, 0, "ins"),
                (distance[i - 1][j] + 1, 0, 0, 1, "del"),
            ]
            _, sub, ins, delete, operation = min(choices, key=lambda item: (item[0], item[4]))
            distance[i][j] = distance[i - 1][j - 1] + 1 if operation == "sub" else (
                distance[i][j - 1] + 1 if operation == "ins" else distance[i - 1][j] + 1
            )
            substitutions[i][j] = substitutions[i - 1][j - 1] + sub if operation == "sub" else (
                substitutions[i][j - 1] if operation == "ins" else substitutions[i - 1][j]
            )
            insertions[i][j] = insertions[i - 1][j - 1] + ins if operation == "sub" else (
                insertions[i][j - 1] + ins if operation == "ins" else insertions[i - 1][j]
            )
            deletions[i][j] = deletions[i - 1][j - 1] + delete if operation == "sub" else (
                deletions[i][j - 1] if operation == "ins" else deletions[i - 1][j] + delete
            )
    return distance[-1][-1], substitutions[-1][-1], insertions[-1][-1], deletions[-1][-1]


def score(reference: str, hypothesis: str) -> dict:
    ref = normalize(reference)
    hyp = normalize(hypothesis)
    ref_words, hyp_words = ref.split(), hyp.split()
    errors, substitutions, insertions, deletions = _edit_distance(ref_words, hyp_words)
    ref_chars, hyp_chars = list(ref.replace(" ", "")), list(hyp.replace(" ", ""))
    char_errors, _, _, _ = _edit_distance(ref_chars, hyp_chars)
    return {
        "wer": round(errors / max(len(ref_words), 1), 6),
        "cer": round(char_errors / max(len(ref_chars), 1), 6),
        "exact_match": ref == hyp,
        "word_errors": errors,
        "substitutions": substitutions,
        "insertions": insertions,
        "deletions": deletions,
        "reference_words": len(ref_words),
        "reference_chars": len(ref_chars),
    }


def _wav_duration(path: Path) -> float | None:
    try:
        with wave.open(str(path), "rb") as wav:
            return wav.getnframes() / wav.getframerate()
    except (wave.Error, OSError, ZeroDivisionError):
        return None


def _language_base(language: str) -> str | None:
    return language.split("-", 1)[0] if language else None


class WhisperProvider:
    def __init__(self, model: str):
        self.name = f"whisper:{model}"
        with _WHISPER_CACHE_LOCK:
            self._model = _WHISPER_CACHE.get(model)
            if self._model is None:
                try:
                    import whisper
                except ImportError as exc:
                    raise RuntimeError("install openai-whisper and ffmpeg for Whisper") from exc
                self._model = whisper.load_model(model)
                _WHISPER_CACHE[model] = self._model

    def transcribe(self, audio: Path, language: str) -> str:
        try:
            result = self._model.transcribe(
                str(audio), language=_language_base(language), task="transcribe", fp16=False
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                "Whisper requires ffmpeg in PATH; install FFmpeg and restart the terminal"
            ) from exc
        return str(result.get("text", "")).strip()


class SarvamProvider:
    def __init__(self, api_key: str, model: str, timeout: float, url: str = DEFAULT_SARVAM_URL):
        if not api_key:
            raise RuntimeError("SARVAM_API_KEY is not set")
        self.name = f"sarvam:{model}"
        self._api_key, self._model, self._timeout, self._url = api_key, model, timeout, url

    def transcribe(self, audio: Path, language: str) -> str:
        boundary = f"----checkin-ai-{uuid.uuid4().hex}"
        body = bytearray()

        def field(name: str, value: str) -> None:
            body.extend(f"--{boundary}\r\n".encode())
            body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
            body.extend(value.encode())
            body.extend(b"\r\n")

        field("model", self._model)
        field("language_code", language)
        field("with_timestamps", "false")
        data = audio.read_bytes()
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(
            f'Content-Disposition: form-data; name="file"; filename="{audio.name}"\r\n'
            f"Content-Type: { _content_type(audio) }\r\n\r\n".encode()
        )
        body.extend(data)
        body.extend(b"\r\n")
        body.extend(f"--{boundary}--\r\n".encode())
        request = urllib.request.Request(
            self._url,
            data=bytes(body),
            headers={
                "api-subscription-key": self._api_key,
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"Sarvam HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Sarvam connection failed: {exc.reason}") from exc
        transcript = payload.get("transcript")
        if not isinstance(transcript, str):
            raise RuntimeError("Sarvam response did not contain a transcript")
        return transcript.strip()


def _content_type(path: Path) -> str:
    return {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".webm": "audio/webm",
        ".ogg": "audio/ogg",
    }.get(path.suffix.casefold(), "application/octet-stream")


def load_manifest(path: Path, audio_root: Path | None = None, split: str | None = None) -> list[Case]:
    cases: list[Case] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            item = json.loads(line)
            case = Case(
                case_id=str(item["id"]),
                audio=(
                    (audio_root / item["audio"]).resolve()
                    if audio_root
                    else (path.parent / item["audio"]).resolve()
                ),
                reference=str(item["reference"]),
                language=str(item.get("language", "en-IN")),
                split=str(item.get("split", "test")),
                scenario=str(item.get("scenario", "unspecified")),
                difficulty=str(item.get("difficulty", "unspecified")),
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ValueError(f"{path}:{line_number}: invalid manifest row: {exc}") from exc
        if split is None or case.split == split:
            cases.append(case)
    if not cases:
        raise ValueError("manifest contains no selected cases")
    missing = [str(case.audio) for case in cases if not case.audio.is_file()]
    if missing:
        raise FileNotFoundError(f"audio files not found: {', '.join(missing[:5])}")
    return cases


def run(cases: list[Case], providers: list[Provider]) -> dict:
    rows: list[dict] = []
    for case in cases:
        duration = _wav_duration(case.audio)
        for provider in providers:
            started = time.perf_counter()
            row = {
                "case_id": case.case_id,
                "provider": provider.name,
                "language": case.language,
                "split": case.split,
                "scenario": case.scenario,
                "difficulty": case.difficulty,
                "audio": str(case.audio),
                "reference": case.reference,
                "duration_seconds": duration,
            }
            try:
                transcript = provider.transcribe(case.audio, case.language)
                elapsed = time.perf_counter() - started
                row.update(
                    transcript=transcript,
                    latency_seconds=round(elapsed, 6),
                    real_time_factor=round(elapsed / duration, 6) if duration else None,
                    status="ok",
                    error=None,
                    **score(case.reference, transcript),
                )
            except Exception as exc:
                row.update(
                    transcript="",
                    latency_seconds=round(time.perf_counter() - started, 6),
                    real_time_factor=None,
                    status="error",
                    error=f"{type(exc).__name__}: {exc}",
                    **score(case.reference, ""),
                )
            rows.append(row)
    return {"cases": len(cases), "providers": sorted({p.name for p in providers}), "rows": rows}


def summarize(report: dict) -> list[dict]:
    summaries = []
    for provider in report["providers"]:
        rows = [row for row in report["rows"] if row["provider"] == provider]
        successful = [row for row in rows if row["status"] == "ok"]
        summaries.append(
            {
                "provider": provider,
                "cases": len(rows),
                "successful": len(successful),
                "failed": len(rows) - len(successful),
                "mean_wer": _mean(successful, "wer"),
                "mean_cer": _mean(successful, "cer"),
                "exact_match_rate": _mean(successful, "exact_match"),
                "median_latency_seconds": _median(successful, "latency_seconds"),
                "median_real_time_factor": _median(
                    [row for row in successful if row["real_time_factor"] is not None],
                    "real_time_factor",
                ),
            }
        )
    return summaries


def summarize_by_language(report: dict) -> list[dict]:
    groups = sorted({(row["provider"], row["language"]) for row in report["rows"]})
    result = []
    for provider, language in groups:
        rows = [
            row for row in report["rows"]
            if row["provider"] == provider and row["language"] == language
            and row["status"] == "ok"
        ]
        result.append({
            "provider": provider,
            "language": language,
            "successful": len(rows),
            "mean_wer": _mean(rows, "wer"),
            "mean_cer": _mean(rows, "cer"),
            "exact_match_rate": _mean(rows, "exact_match"),
        })
    return result


def _mean(rows: list[dict], key: str) -> float | None:
    if not rows:
        return None
    return round(sum(float(row[key]) for row in rows) / len(rows), 6)


def _median(rows: list[dict], key: str) -> float | None:
    if not rows:
        return None
    values = sorted(float(row[key]) for row in rows)
    middle = len(values) // 2
    value = values[middle] if len(values) % 2 else (values[middle - 1] + values[middle]) / 2
    return round(value, 6)


def write_reports(report: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    report["summary"] = summarize(report)
    report["summary_by_language"] = summarize_by_language(report)
    (output_dir / "asr_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if report["rows"]:
        with (output_dir / "asr_results.csv").open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(report["rows"][0]))
            writer.writeheader()
            writer.writerows(report["rows"])
    lines = [
        "# ASR benchmark report",
        "",
        f"Cases: {report['cases']}",
        "",
        "| Provider | Success | Failed | Mean WER | Mean CER | Exact match | Median latency (s) | Median RTF |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for item in report["summary"]:
        lines.append(
            f"| {item['provider']} | {item['successful']} | {item['failed']} | "
            f"{_display(item['mean_wer'])} | {_display(item['mean_cer'])} | "
            f"{_display(item['exact_match_rate'])} | {_display(item['median_latency_seconds'])} | "
            f"{_display(item['median_real_time_factor'])} |"
        )
    lines.extend([
        "",
        "## Results by language",
        "",
        "| Provider | Language | Successful | Mean WER | Mean CER | Exact match |",
        "|---|---|---:|---:|---:|---:|",
    ])
    for item in report["summary_by_language"]:
        lines.append(
            f"| {item['provider']} | {item['language']} | {item['successful']} | "
            f"{_display(item['mean_wer'])} | {_display(item['mean_cer'])} | "
            f"{_display(item['exact_match_rate'])} |"
        )
    if report.get("provider_errors"):
        lines.extend(["", "## Providers unavailable before the run", ""])
        for provider, error in report["provider_errors"].items():
            lines.append(f"- **{provider}**: {error}")
    lines.extend(["", "RTF below 1.0 means faster than the audio duration.", ""])
    (output_dir / "asr_report.md").write_text("\n".join(lines), encoding="utf-8")


def _display(value) -> str:
    return "-" if value is None else str(value)


def _provider(name: str, args) -> Provider:
    if name == "whisper":
        return WhisperProvider(args.whisper_model)
    if name == "sarvam":
        import os
        return SarvamProvider(
            os.environ.get("SARVAM_API_KEY", ""),
            args.sarvam_model,
            args.timeout,
            args.sarvam_url,
        )
    raise ValueError(f"unknown provider: {name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--audio-root", type=Path)
    parser.add_argument("--split", choices=["dev", "test", "all"], default="all")
    parser.add_argument("--provider", choices=["whisper", "sarvam"], nargs="+",
                        default=["whisper", "sarvam"])
    parser.add_argument("--output-dir", type=Path, default=Path("reports"))
    parser.add_argument("--limit", type=int)
    parser.add_argument("--timeout", type=float, default=60)
    parser.add_argument("--whisper-model", default="small")
    parser.add_argument("--sarvam-model", default="saaras:v4")
    parser.add_argument("--sarvam-url", default=DEFAULT_SARVAM_URL)
    args = parser.parse_args()
    split = None if args.split == "all" else args.split
    cases = load_manifest(args.manifest, args.audio_root, split)
    if args.limit:
        cases = cases[:args.limit]
    providers = []
    provider_errors = {}
    for name in args.provider:
        try:
            providers.append(_provider(name, args))
        except Exception as exc:
            provider_errors[name] = f"{type(exc).__name__}: {exc}"
            print(f"SKIP {name}: {provider_errors[name]}")
    if not providers:
        raise SystemExit("No providers available. Install/configure at least one provider.")
    report = run(cases, providers)
    report["provider_errors"] = provider_errors
    write_reports(report, args.output_dir)
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print(f"Reports written to {args.output_dir}")


if __name__ == "__main__":
    main()
