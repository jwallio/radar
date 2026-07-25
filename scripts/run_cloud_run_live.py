from __future__ import annotations

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

from radar_processing.control import fetch_polling_enabled  # noqa: E402
from radar_processing.manifest import write_json_atomic  # noqa: E402
from radar_processing.r2 import R2PublishConfig, create_r2_client, publish_directory, prune_old_frames  # noqa: E402


LOGGER = logging.getLogger("wallcloud.radar.cloudrun.live")


def _status(ok: bool, message: str, *, skipped: bool = False) -> dict[str, Any]:
    return {
        "worker": "wallcloud-radar-cloud-run",
        "mode": "live",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ok": ok,
        "skipped": skipped,
        "message": message,
    }


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )
    try:
        if not fetch_polling_enabled():
            LOGGER.info("Live polling is disabled; Cloud Run job exits without NOAA downloads")
            return 0
    except RuntimeError as exc:
        LOGGER.error("%s", exc)
        return 1

    status_path = ROOT / "public" / "data" / "radar" / "worker-status.json"
    try:
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "build_krax_radar.py")],
            cwd=ROOT,
            check=False,
        )
        if result.returncode:
            write_json_atomic(status_path, _status(False, f"KRAX processor exited with code {result.returncode}"))
            return result.returncode
        config = R2PublishConfig.from_env()
        client = create_r2_client(config)
        write_json_atomic(status_path, _status(True, "KRAX Level II frame generation completed"))
        keys = publish_directory(
            client,
            config,
            ROOT / "public" / "data",
            exclude_prefixes=("radar/history", "radar/krax/history"),
            include_relative_paths=("radar/worker-status.json",),
            include_prefixes=("radar/krax", "observations"),
        )
        LOGGER.info("Published %d live R2 objects", len(keys))
        LOGGER.info("Pruned %d old live R2 objects", len(prune_old_frames(client, config)))
        return 0
    except Exception:
        LOGGER.exception("Cloud Run live refresh failed")
        try:
            write_json_atomic(status_path, _status(False, "Cloud Run live refresh failed"))
        except Exception:
            LOGGER.exception("Unable to write local failure status")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
