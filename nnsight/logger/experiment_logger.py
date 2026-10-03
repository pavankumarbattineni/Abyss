"""
Structured, append-only logging for NNSight model-execution and
interpretability runs.

Each script gets exactly ONE persistent pair of log files in
`logger/logs/`, named after the script itself (not the timestamp):

  - `<script_name>.log`   human-readable narrative log, appended to on
                           every run (never truncated).
  - `<script_name>.json`  a single JSON document of the form
                           {"runs": [ {...run 1...}, {...run 2...}, ... ]}
                           -- every execution of the script adds one more
                           entry to "runs"; existing runs are preserved.

This means running the same script again -- with a new prompt, the same
prompt, or just repeatedly -- always APPENDS a new run; it never
overwrites earlier runs. Each run entry has a unique, sequential
`run_id` (1, 2, 3, ... scoped to that script's log file), a UTC
`timestamp`, the `model`, the `prompt`, a `generated_output` field
(filled in once the script logs a "generation" event), and a full
`events` list capturing every stage of that run (model load,
tokenization, per-layer shapes, logit lens, final logits, causal
interventions, ...).

The JSON file is rewritten in full after every logged event, so it is
always valid, complete JSON on disk -- a run that crashes partway
through still leaves every prior run, and everything logged so far in
the current run, intact and readable.

Usage:
    from logger.experiment_logger import ExperimentLogger

    log = ExperimentLogger(model_name="openai-community/gpt2",
                            script_name="inspect_gpt2", prompt=PROMPT)
    log.section("STAGE 1: Tokenization")
    log.event("tokenization", tokens=tokens, token_strings=token_strs)
    ...
    log.close()
"""

import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent / "logs"

# event data keys that, if present on a "generation"-type event, are
# promoted to the run's top-level `generated_output` field.
_GENERATED_OUTPUT_KEYS = ("response", "continuation", "full_text")


class ExperimentLogger:
    def __init__(self, model_name, script_name, prompt):
        LOG_DIR.mkdir(parents=True, exist_ok=True)

        self.script_name = script_name
        self.json_path = LOG_DIR / f"{script_name}.json"
        self.log_path = LOG_DIR / f"{script_name}.log"

        # Load prior runs (if any) so this run is APPENDED, not overwritten.
        self._data = self._load_existing()
        self.run_id = len(self._data["runs"]) + 1
        self.run = {
            "run_id": self.run_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "model": model_name,
            "prompt": prompt,
            "generated_output": None,
            "events": [],
        }
        self._data["runs"].append(self.run)
        self._write_json()

        # One dedicated logger per (script, run) so console/file handlers
        # from a previous run in the same process don't double-log.
        self._logger = logging.getLogger(f"{script_name}.run{self.run_id}.{id(self)}")
        self._logger.setLevel(logging.INFO)
        self._logger.propagate = False
        fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S")

        # mode="a": append across runs, never truncate previous runs' logs.
        file_handler = logging.FileHandler(self.log_path, mode="a", encoding="utf-8")
        file_handler.setFormatter(fmt)
        self._logger.addHandler(file_handler)

        stream_handler = logging.StreamHandler(sys.stdout)
        stream_handler.setFormatter(fmt)
        self._logger.addHandler(stream_handler)

        self._logger.info("=" * 70)
        self._logger.info(f"RUN {self.run_id} START -- model={model_name}")
        self._logger.info(f"Prompt: {prompt!r}")
        self._logger.info("=" * 70)

        self.event("run_start", script=script_name, model=model_name, prompt=prompt)

    def _load_existing(self):
        if self.json_path.exists():
            try:
                with open(self.json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict) and isinstance(data.get("runs"), list):
                    return data
            except (json.JSONDecodeError, OSError):
                pass  # corrupt/missing file -> start a fresh run history
        return {"runs": []}

    def _write_json(self):
        with open(self.json_path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, indent=2, default=str)
            f.write("\n")

    def _append_event(self, record):
        self.run["events"].append(record)
        self._write_json()

    def section(self, title):
        """Print/log a visual section header (STAGE N: ...)."""
        self._logger.info("-" * 70)
        self._logger.info(title)
        self._append_event(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "event": "section",
                "title": title,
            }
        )

    def info(self, message):
        """Narrative line: written to console + .log only (not .json)."""
        self._logger.info(message)

    def event(self, event_type, **data):
        """Structured record: written to console + .log (as a summary
        line) AND appended to this run's `events` array in .json."""
        summary = ", ".join(f"{k}={v!r}" for k, v in data.items())
        self._logger.info(f"[{event_type}] {summary}" if summary else f"[{event_type}]")

        for key in _GENERATED_OUTPUT_KEYS:
            if key in data:
                self.run["generated_output"] = data[key]
                break

        self._append_event(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "event": event_type,
                **data,
            }
        )

    def error(self, message):
        self._logger.error(message)
        self._append_event(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "event": "error",
                "message": message,
            }
        )

    def close(self):
        self.event("run_end")
        self._logger.info(f"RUN {self.run_id} END\n")
        for handler in list(self._logger.handlers):
            handler.close()
            self._logger.removeHandler(handler)