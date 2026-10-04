import json
import wave

from asr_benchmark.asr_benchmark import (
    Case,
    load_manifest,
    run,
    score,
    summarize,
    summarize_by_language,
    write_reports,
)


class FakeProvider:
    name = "fake"

    def __init__(self, transcript):
        self.transcript = transcript

    def transcribe(self, audio, language):
        return self.transcript


def _wav(path):
    with wave.open(str(path), "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(8000)
        stream.writeframes(b"\0" * 8000)


def test_score_reports_word_and_character_metrics():
    result = score("Rahul Sharma arrived", "Rahul Sharma arrived")
    assert result["wer"] == 0 and result["cer"] == 0 and result["exact_match"]

    result = score("one two", "one three")
    assert result["wer"] == 0.5
    assert result["substitutions"] == 1


def test_benchmark_preserves_successes_and_provider_errors(tmp_path):
    audio = tmp_path / "sample.wav"
    _wav(audio)
    case = Case("one", audio, "Rahul Sharma arrived", "en-IN")
    report = run([case], [FakeProvider("Rahul Sharma arrived"), FakeProvider("wrong")])
    assert len(report["rows"]) == 2
    assert report["rows"][0]["status"] == "ok"
    assert report["rows"][0]["real_time_factor"] is not None
    assert report["rows"][1]["wer"] > 0
    assert summarize_by_language(report)[0]["language"] == "en-IN"


def test_provider_exception_is_recorded_not_lost(tmp_path):
    audio = tmp_path / "sample.wav"
    _wav(audio)

    class Broken(FakeProvider):
        name = "broken"

        def transcribe(self, audio, language):
            raise RuntimeError("quota")

    report = run([Case("one", audio, "hello", "en-IN")], [Broken("")])
    row = report["rows"][0]
    assert row["status"] == "error"
    assert "quota" in row["error"]
    assert summarize(report)[0]["failed"] == 1


def test_manifest_resolves_audio_root_and_split(tmp_path):
    audio = tmp_path / "one.wav"
    _wav(audio)
    manifest = tmp_path / "manifest.jsonl"
    manifest.write_text(json.dumps({
        "id": "one", "audio": "one.wav", "reference": "hello",
        "language": "en-IN", "split": "test",
    }) + "\n", encoding="utf-8")
    cases = load_manifest(manifest, tmp_path, "test")
    assert cases[0].audio == audio.resolve()


def test_manifest_without_audio_root_resolves_relative_to_manifest(tmp_path):
    audio = tmp_path / "audio" / "one.wav"
    audio.parent.mkdir()
    _wav(audio)
    manifest = tmp_path / "manifest.jsonl"
    manifest.write_text(json.dumps({
        "id": "one", "audio": "audio/one.wav", "reference": "hello",
        "language": "en-IN",
    }) + "\n", encoding="utf-8")
    assert load_manifest(manifest)[0].audio == audio.resolve()


def test_reports_write_json_csv_and_markdown(tmp_path):
    audio = tmp_path / "sample.wav"
    _wav(audio)
    report = run([Case("one", audio, "hello", "en-IN")], [FakeProvider("hello")])
    report["provider_errors"] = {"sarvam": "RuntimeError: credentials unavailable"}
    output = tmp_path / "reports"
    write_reports(report, output)
    assert (output / "asr_report.json").is_file()
    assert (output / "asr_results.csv").is_file()
    markdown = (output / "asr_report.md").read_text(encoding="utf-8")
    assert "ASR benchmark report" in markdown
    assert "Results by language" in markdown
    assert "credentials unavailable" in markdown
