# Evaluation data

* `synthetic_v1.jsonl` - 100 generated sentences (regenerate with `python -m eval.dataset`).
  `split` is `dev` (tune prompts on these) or `test` (FROZEN: never tune on these).
* `human_v1.jsonl` - YOUR job: 30-40 sentences written by people who did NOT write the prompts
  (ask friends), in the same JSON-lines format as the synthetic file, including messy ones:
  spelling mistakes, Hinglish, background-noise speech-to-text errors. Mark them `"split": "test"`.
