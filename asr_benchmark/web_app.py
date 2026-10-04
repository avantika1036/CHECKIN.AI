"""Small browser interface for comparing browser, Sarvam, and Whisper STT."""
from __future__ import annotations

import json
import os
import tempfile
import time
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from asr_benchmark import SarvamProvider, WhisperProvider, score


ROOT = Path(__file__).parent
HTML = (ROOT / "web_index.html").read_text(encoding="utf-8")
RUNS = ROOT / "runs"
MANIFEST = ROOT / "data" / "asr_manifest.jsonl"


def _load_manifest() -> dict[str, dict]:
    if not MANIFEST.is_file():
        return {}
    cases = {}
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        if line.strip():
            item = json.loads(line)
            cases[item["id"]] = item
    return cases


CASES = _load_manifest()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if self.path == "/report":
            report = RUNS / "final_report.md"
            if not report.is_file():
                self.send_error(404, "No report has been generated yet")
                return
            body = report.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path != "/":
            self.send_error(404)
            return
        body = HTML.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path == "/finalize":
            try:
                self._json(200, self._finalize())
            except Exception as exc:
                self._json(400, {"error": f"{type(exc).__name__}: {exc}"})
            return
        if self.path != "/benchmark":
            self.send_error(404)
            return
        try:
            result = self._benchmark()
            self._json(200, result)
        except Exception as exc:
            self._json(400, {"error": f"{type(exc).__name__}: {exc}"})

    def _benchmark(self) -> dict:
        content_type = self.headers.get("Content-Type", "")
        if not content_type.startswith("multipart/form-data"):
            raise ValueError("Expected a multipart form submission")
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        message = BytesParser(policy=policy.default).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode()
            + body
        )
        fields = {}
        audio_name = None
        audio_data = None
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if name == "audio":
                audio_name = part.get_filename()
                audio_data = part.get_payload(decode=True)
            elif name:
                raw_value = part.get_payload(decode=True)
                if raw_value is None:
                    fields[name] = part.get_content()
                else:
                    charset = part.get_content_charset() or "utf-8"
                    fields[name] = raw_value.decode(charset, errors="replace")
        case_id = fields.get("case_id", "unlabelled").strip() or "unlabelled"
        submitted_reference = fields.get("reference", "").strip()
        submitted_language = fields.get("language", "en-IN").strip() or "en-IN"
        canonical_case = CASES.get(case_id)
        reference = canonical_case["reference"] if canonical_case else submitted_reference
        language = canonical_case["language"] if canonical_case else submitted_language
        selected = [item for item in fields.get("providers", "sarvam").split(",") if item]
        browser_transcript = fields.get("browser_transcript", "").strip()
        browser_latency = float(fields.get("browser_latency", "0") or 0)
        if not reference:
            raise ValueError("Reference transcript is required")
        if not audio_data:
            raise ValueError("Record or select an audio file first")
        suffix = Path(audio_name or "recording.webm").suffix or ".webm"
        file_descriptor, temp_name = tempfile.mkstemp(suffix=suffix)
        try:
            with os.fdopen(file_descriptor, "wb") as temp:
                temp.write(audio_data)
            providers = []
            setup_errors = {}
            for name in selected:
                try:
                    if name == "sarvam":
                        providers.append(SarvamProvider(
                            os.environ.get("SARVAM_API_KEY", ""),
                            "saaras:v4",
                            60,
                        ))
                    elif name.startswith("whisper:"):
                        providers.append(WhisperProvider(name.split(":", 1)[1]))
                except Exception as exc:
                    setup_errors[name] = f"{type(exc).__name__}: {exc}"
            if not providers and setup_errors:
                raise RuntimeError("; ".join(
                    f"{name}: {error}" for name, error in setup_errors.items()
                ))
            results = []
            if "browser" in selected:
                if browser_transcript:
                    results.append({
                        "provider": "browser:web-speech",
                        "status": "ok",
                        "transcript": browser_transcript,
                        "latency_seconds": round(browser_latency, 6),
                        **score(reference, browser_transcript),
                    })
                else:
                    results.append({
                        "provider": "browser:web-speech",
                        "status": "error",
                        "transcript": "",
                        "error": "Browser speech recognition returned no transcript",
                        "latency_seconds": round(browser_latency, 6),
                        **score(reference, ""),
                    })
            for provider in providers:
                started = time.perf_counter()
                try:
                    transcript = provider.transcribe(Path(temp_name), language)
                    results.append({
                        "provider": provider.name,
                        "status": "ok",
                        "transcript": transcript,
                        "latency_seconds": round(
                            time.perf_counter() - started, 6
                        ),
                        **score(reference, transcript),
                    })
                except Exception as exc:
                    results.append({
                        "provider": provider.name,
                        "status": "error",
                        "transcript": "",
                        "error": f"{type(exc).__name__}: {exc}",
                        "latency_seconds": round(
                            time.perf_counter() - started, 6
                        ),
                        **score(reference, ""),
                    })
        finally:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass
        self._save_case(case_id, language, reference, audio_data, results)
        return {
            "case_id": case_id,
            "language": language,
            "reference": reference,
            "results": results,
            "setup_errors": setup_errors,
        }

    def _save_case(self, case_id: str, language: str, reference: str,
                   audio_data: bytes, results: list[dict]) -> None:
        RUNS.joinpath("audio").mkdir(parents=True, exist_ok=True)
        safe_id = "".join(char if char.isalnum() or char in "-_" else "_" for char in case_id)
        (RUNS / "audio" / f"{safe_id}.webm").write_bytes(audio_data)
        record = {
            "case_id": case_id,
            "language": language,
            "reference": reference,
            "results": results,
            "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        source = RUNS / "results.jsonl"
        existing = []
        if source.is_file():
            for line in source.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    previous = json.loads(line)
                    if previous.get("case_id") != case_id:
                        existing.append(previous)
                    else:
                        previous_results = {
                            result.get("provider"): result
                            for result in previous.get("results", [])
                            if result.get("provider")
                        }
                        for result in results:
                            provider = result.get("provider")
                            if provider:
                                previous_results[provider] = result
                        record["results"] = list(previous_results.values())
        if not any(item.get("case_id") == case_id for item in existing):
            existing.append(record)
        temporary = RUNS / "results.jsonl.tmp"
        temporary.write_text(
            "\n".join(json.dumps(item, ensure_ascii=False) for item in existing) + "\n",
            encoding="utf-8",
        )
        temporary.replace(source)

    def _finalize(self) -> dict:
        source = RUNS / "results.jsonl"
        if not source.is_file():
            raise ValueError("No benchmark results have been saved yet")
        records = [json.loads(line) for line in source.read_text(encoding="utf-8").splitlines() if line.strip()]
        rows = []
        for record in records:
            canonical_case = CASES.get(record["case_id"])
            reference = canonical_case["reference"] if canonical_case else record["reference"]
            language = canonical_case["language"] if canonical_case else record["language"]
            for result in record["results"]:
                row = {
                    **result,
                    "case_id": record["case_id"],
                    "language": language,
                    "reference": reference,
                }
                if result.get("status") == "ok":
                    row.update(score(reference, result.get("transcript", "")))
                rows.append(row)
        summaries = []
        for provider in sorted({row["provider"] for row in rows}):
            selected = [row for row in rows if row["provider"] == provider]
            successful = [row for row in selected if row["status"] == "ok"]
            def mean(key):
                return round(sum(float(row[key]) for row in successful) / len(successful), 6) if successful else None
            summaries.append({
                "provider": provider, "cases": len(selected), "successful": len(successful),
                "mean_wer": mean("wer"), "mean_cer": mean("cer"),
                "exact_match_rate": mean("exact_match"), "mean_latency_seconds": mean("latency_seconds"),
            })
        report = {"cases": len(records), "rows": rows, "summary": summaries}
        RUNS.mkdir(parents=True, exist_ok=True)
        (RUNS / "final_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        lines = [
            "# ASR final report", "", f"Saved test cases: {len(records)}", "",
            "| Provider | Cases | Successful | Mean WER | Mean CER | Exact match | Mean latency (s) |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ]
        for item in summaries:
            values = [
                item["provider"],
                item["cases"],
                item["successful"],
                f"{item['mean_wer'] * 100:.2f}%" if item["mean_wer"] is not None else "-",
                f"{item['mean_cer'] * 100:.2f}%" if item["mean_cer"] is not None else "-",
                f"{item['exact_match_rate'] * 100:.2f}%" if item["exact_match_rate"] is not None else "-",
                f"{item['mean_latency_seconds']:.2f}" if item["mean_latency_seconds"] is not None else "-",
            ]
            lines.append("| " + " | ".join(map(str, values)) + " |")
        (RUNS / "final_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        self._write_graphs(summaries)
        return {"cases": len(records), "report": "/report",
                "files": ["runs/final_report.md", "runs/final_report.json",
                          "runs/wer.png", "runs/cer.png", "runs/latency.png"]}

    def _write_graphs(self, summaries: list[dict]) -> None:
        try:
            import matplotlib.pyplot as plt
        except ImportError as exc:
            raise RuntimeError("Install matplotlib before generating graphs") from exc
        providers = [item["provider"] for item in summaries]
        for key, filename, title in (
            ("mean_wer", "wer.png", "Mean WER"),
            ("mean_cer", "cer.png", "Mean CER"),
            ("mean_latency_seconds", "latency.png", "Mean latency"),
        ):
            figure, axis = plt.subplots(figsize=(max(7, len(providers)), 4))
            axis.bar(providers, [item[key] or 0 for item in summaries], color="#3155a6")
            axis.set_title(title)
            axis.tick_params(axis="x", rotation=35)
            figure.tight_layout()
            figure.savefig(RUNS / filename, dpi=160)
            plt.close(figure)

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            # The browser may close the request while a long model is still running.
            return

    def log_message(self, format: str, *args) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    port = int(os.environ.get("ASR_UI_PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"ASR recorder: http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
