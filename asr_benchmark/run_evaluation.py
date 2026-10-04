"""Run a structured ASR evaluation and generate tables and graphs."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from asr_benchmark import (
    SarvamProvider,
    WhisperProvider,
    load_manifest,
    run,
    summarize,
    summarize_by_language,
    write_reports,
)


def _mean(rows: list[dict], key: str) -> float | None:
    values = [float(row[key]) for row in rows if row["status"] == "ok" and row[key] is not None]
    return round(sum(values) / len(values), 6) if values else None


def summarize_by_field(rows: list[dict], field: str) -> list[dict]:
    groups = sorted({(row["provider"], row.get(field, "unknown")) for row in rows})
    result = []
    for provider, value in groups:
        selected = [row for row in rows if row["provider"] == provider and row.get(field, "unknown") == value]
        result.append({
            "provider": provider,
            field: value,
            "cases": len(selected),
            "successful": sum(row["status"] == "ok" for row in selected),
            "mean_wer": _mean(selected, "wer"),
            "mean_cer": _mean(selected, "cer"),
            "exact_match_rate": _mean(selected, "exact_match"),
            "mean_latency_seconds": _mean(selected, "latency_seconds"),
        })
    return result


def write_evaluation_outputs(report: dict, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    report["summary"] = summarize(report)
    report["summary_by_language"] = summarize_by_language(report)
    report["summary_by_scenario"] = summarize_by_field(report["rows"], "scenario")
    report["summary_by_difficulty"] = summarize_by_field(report["rows"], "difficulty")
    write_reports(report, output)
    (output / "evaluation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    for name in ("summary_by_scenario", "summary_by_difficulty"):
        rows = report[name]
        if rows:
            with (output / f"{name}.csv").open("w", newline="", encoding="utf-8") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)
    _write_markdown(report, output / "final_report.md")
    _write_graphs(report, output)


def _write_markdown(report: dict, path: Path) -> None:
    lines = [
        "# ASR evaluation report",
        "",
        f"Cases: {report['cases']}",
        "",
        "## Overall results",
        "",
        "| Provider | Cases | Successful | Mean WER | Mean CER | Exact match | Median latency (s) |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for row in report["summary"]:
        lines.append(
            f"| {row['provider']} | {row['cases']} | {row['successful']} | "
            f"{row['mean_wer'] or '-'} | {row['mean_cer'] or '-'} | "
            f"{row['exact_match_rate'] or '-'} | {row['median_latency_seconds'] or '-'} |"
        )
    for title, key in (("By language", "summary_by_language"), ("By scenario", "summary_by_scenario"),
                       ("By difficulty", "summary_by_difficulty")):
        lines.extend(["", f"## {title}", ""])
        rows = report[key]
        if not rows:
            continue
        fields = [field for field in rows[0] if field not in {"provider"}]
        lines.append("| Provider | " + " | ".join(fields) + " |")
        lines.append("|" + "---|" * (len(fields) + 1))
        for row in rows:
            lines.append("| " + " | ".join(str(row.get(field, "-")) for field in ["provider", *fields]) + " |")
    lines.extend(["", "Graphs are stored alongside this report as PNG files.", ""])
    path.write_text("\n".join(lines), encoding="utf-8")


def _write_graphs(report: dict, output: Path) -> None:
    try:
        import matplotlib.pyplot as plt
    except ImportError as exc:
        raise RuntimeError("Install matplotlib to generate evaluation graphs") from exc
    summary = report["summary"]
    providers = [row["provider"] for row in summary]
    for metric, filename, title, ylabel in (
        ("mean_wer", "wer_by_provider.png", "Mean word error rate", "WER"),
        ("mean_cer", "cer_by_provider.png", "Mean character error rate", "CER"),
        ("median_latency_seconds", "latency_by_provider.png", "Median latency", "Seconds"),
        ("exact_match_rate", "exact_match_by_provider.png", "Exact-match rate", "Rate"),
    ):
        values = [row[metric] or 0 for row in summary]
        figure, axis = plt.subplots(figsize=(max(7, len(providers) * 1.3), 4.5))
        axis.bar(providers, values, color="#3155a6")
        axis.set_title(title)
        axis.set_ylabel(ylabel)
        axis.tick_params(axis="x", rotation=35)
        figure.tight_layout()
        figure.savefig(output / filename, dpi=160)
        plt.close(figure)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=Path("data/asr_manifest.jsonl"))
    parser.add_argument("--output-dir", type=Path, default=Path("reports/final"))
    parser.add_argument("--split", choices=["dev", "test", "all"], default="test")
    parser.add_argument("--whisper-model", nargs="+", default=["tiny", "base", "small"])
    parser.add_argument("--no-sarvam", action="store_true")
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()
    cases = load_manifest(args.manifest, split=None if args.split == "all" else args.split)
    providers = []
    for model in args.whisper_model:
        providers.append(WhisperProvider(model))
    if not args.no_sarvam:
        import os
        providers.append(SarvamProvider(os.environ.get("SARVAM_API_KEY", ""), "saaras:v4", args.timeout))
    report = run(cases, providers)
    write_evaluation_outputs(report, args.output_dir)
    print(f"Evaluation complete. Reports and graphs written to {args.output_dir}")


if __name__ == "__main__":
    main()
