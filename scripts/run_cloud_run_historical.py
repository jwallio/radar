from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from radar_processing.history import dataset_id_for_range, parse_timestamp  # noqa: E402
from radar_processing.manifest import write_json_atomic  # noqa: E402
from radar_processing.r2 import R2PublishConfig, create_r2_client, publish_directory, put_json_object  # noqa: E402


LOGGER = logging.getLogger("wallcloud.radar.cloudrun.history")


def _job_id() -> str:
    return os.getenv("HISTORY_JOB_ID", "history-manual").strip() or "history-manual"


def _status(status: str, message: str, **extra: Any) -> dict[str, Any]:
    return {
        "job_id": _job_id(),
        "source": os.getenv("HISTORY_SOURCE", "krax").strip().lower(),
        "status": status,
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "message": message,
        **extra,
    }


def _write_status(payload: dict[str, Any], client: Any = None, config: R2PublishConfig | None = None) -> None:
    status_path = ROOT / "public" / "data" / "radar" / "krax" / "history" / "jobs" / f"{_job_id()}.json"
    write_json_atomic(status_path, payload)
    if client is not None and config is not None:
        put_json_object(client, config, f"radar/krax/history/jobs/{_job_id()}.json", payload)


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )
    source = os.getenv("HISTORY_SOURCE", "krax").strip().lower()
    if source != "krax":
        LOGGER.error("Only KRAX historical jobs are enabled in this Cloud Run image")
        return 2
    start = parse_timestamp(os.environ["HISTORY_START"])
    end = parse_timestamp(os.environ["HISTORY_END"])
    max_frames = max(1, min(90, int(os.getenv("HISTORY_MAX_FRAMES", "30"))))
    dataset_id = f"krax-{dataset_id_for_range(start, end)}"
    config = R2PublishConfig.from_env()
    client = create_r2_client(config)
    _write_status(_status("running", "KRAX Level II historical job started", dataset_id=dataset_id), client, config)
    try:
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts" / "build_historical_krax.py"),
                "--start",
                os.environ["HISTORY_START"],
                "--end",
                os.environ["HISTORY_END"],
                "--max-frames",
                str(max_frames),
            ],
            cwd=ROOT,
            check=False,
        )
        if result.returncode:
            _write_status(_status("failed", f"Historical processor exited with code {result.returncode}", dataset_id=dataset_id), client, config)
            return result.returncode
        keys = publish_directory(
            client,
            config,
            ROOT / "public" / "data",
            include_prefixes=("radar/krax/history",),
        )
        manifest_url = f"radar/krax/history/{dataset_id}/manifest.json"
        _write_status(
            _status(
                "complete",
                f"Published {len(keys)} historical R2 objects",
                dataset_id=dataset_id,
                manifest_url=manifest_url,
            ),
            client,
            config,
        )
        LOGGER.info("Historical dataset %s is ready", dataset_id)
        return 0
    except Exception as exc:
        LOGGER.exception("Cloud Run historical job failed")
        _write_status(_status("failed", str(exc), dataset_id=dataset_id), client, config)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
