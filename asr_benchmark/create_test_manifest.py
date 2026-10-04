"""Create a structured ASR test manifest that users can populate with recordings."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


CASES = [
    ("en-clean-01", "en-IN", "clean", "easy", "Rahul Sharma is here"),
    ("en-clean-02", "en-IN", "clean", "easy", "Please register Anita Singh"),
    ("en-name-01", "en-IN", "names", "medium", "Rahul Sharma is here to meet Dr. Naveen Aggarwal"),
    ("en-name-02", "en-IN", "names", "medium", "Please register Dr. Harpreet Kaur from the CSE department"),
    ("en-phone-01", "en-IN", "phone", "hard", "Rahul Sharma phone number is 98765 43210"),
    ("en-purpose-01", "en-IN", "purpose", "medium", "Rahul Sharma is here for a project discussion"),
    ("en-noise-01", "en-IN", "noise", "hard", "Anita Singh is here to meet the department head"),
    ("en-accent-01", "en-IN", "accent", "hard", "Please check out Rahul Sharma from the visitor gate"),
    ("hi-clean-01", "hi-IN", "clean", "easy", "राहुल शर्मा यहां हैं"),
    ("hi-name-01", "hi-IN", "names", "medium", "राहुल शर्मा डॉ नवीन अग्रवाल से मिलने आए हैं"),
    ("hi-phone-01", "hi-IN", "phone", "hard", "राहुल शर्मा का फोन नंबर नौ आठ सात छह पांच चार तीन दो एक शून्य है"),
    ("hi-purpose-01", "hi-IN", "purpose", "medium", "राहुल शर्मा परियोजना चर्चा के लिए आए हैं"),
    ("hi-noise-01", "hi-IN", "noise", "hard", "कृपया अनिता सिंह का आगंतुक पंजीकरण करें"),
    ("hi-mixed-01", "hi-IN", "mixed", "hard", "राहुल शर्मा project discussion के लिए आए हैं"),
    ("pa-clean-01", "pa-IN", "clean", "easy", "ਰਾਹੁਲ ਸ਼ਰਮਾ ਇੱਥੇ ਹਨ"),
    ("pa-name-01", "pa-IN", "names", "medium", "ਰਾਹੁਲ ਸ਼ਰਮਾ ਡਾਕਟਰ ਨਵੀਨ ਅਗਰਵਾਲ ਨੂੰ ਮਿਲਣ ਆਏ ਹਨ"),
    ("pa-phone-01", "pa-IN", "phone", "hard", "ਰਾਹੁਲ ਸ਼ਰਮਾ ਦਾ ਫੋਨ ਨੰਬਰ ਨੌਂ ਅੱਠ ਸੱਤ ਛੇ ਪੰਜ ਚਾਰ ਤਿੰਨ ਦੋ ਇੱਕ ਸਿਫ਼ਰ ਹੈ"),
    ("pa-purpose-01", "pa-IN", "purpose", "medium", "ਰਾਹੁਲ ਸ਼ਰਮਾ ਪ੍ਰੋਜੈਕਟ ਚਰਚਾ ਲਈ ਆਏ ਹਨ"),
    ("pa-noise-01", "pa-IN", "noise", "hard", "ਕਿਰਪਾ ਕਰਕੇ ਅਨੀਤਾ ਸਿੰਘ ਦੀ ਵਿਜ਼ਟਰ ਰਜਿਸਟ੍ਰੇਸ਼ਨ ਕਰੋ"),
    ("pa-mixed-01", "pa-IN", "mixed", "hard", "ਰਾਹੁਲ ਸ਼ਰਮਾ project discussion ਲਈ ਆਏ ਹਨ"),
]


def create_manifest(output: Path, audio_dir: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    audio_reference_dir = Path(audio_dir)
    if audio_reference_dir.is_absolute():
        audio_reference_dir = Path(
            str(audio_reference_dir.relative_to(output.parent.resolve()))
        )
    elif audio_reference_dir.parts[:len(output.parent.parts)] == output.parent.parts:
        audio_reference_dir = Path(*audio_reference_dir.parts[len(output.parent.parts):])
    for case_id, language, scenario, difficulty, reference in CASES:
        rows.append({
            "id": case_id,
            "audio": str(audio_reference_dir / f"{case_id}.webm"),
            "reference": reference,
            "language": language,
            "split": "test",
            "scenario": scenario,
            "difficulty": difficulty,
        })
    output.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("data/asr_manifest.jsonl"))
    parser.add_argument("--audio-dir", type=Path, default=Path("data/audio"))
    args = parser.parse_args()
    create_manifest(args.output, args.audio_dir)
    print(f"Created {len(CASES)} test cases in {args.output}")
    print(f"Record one audio file for each case under {args.audio_dir}")


if __name__ == "__main__":
    main()
