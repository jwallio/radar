from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from radar_processing.config import RegionBounds  # noqa: E402
from radar_processing.era5 import ERA5_DEFAULT_REGION, ERA5_MAX_FRAMES, ERA5_MAX_HOURS, era5_dataset_id  # noqa: E402
from radar_processing.history import dataset_id_for_range, parse_timestamp  # noqa: E402
from radar_processing.manifest import write_json_atomic  # noqa: E402
from radar_processing.r2 import (  # noqa: E402
    R2PublishConfig,
    create_r2_client,
    get_json_object,
    get_json_object_with_etag,
    is_precondition_failed,
    publish_directory,
    put_json_object,
)


LOGGER = logging.getLogger("wallcloud.radar.cloudrun.history")


def _job_id() -> str:
    return os.getenv("HISTORY_JOB_ID", "history-manual").strip() or "history-manual"


def _source() -> str:
    return os.getenv("HISTORY_SOURCE", "krax").strip().lower()


def _history_prefix() -> str:
    if _source() == "era5":
        return "radar/history/era5"
    return "radar/history" if _source() == "mrms" else "radar/krax/history"


def _status(status: str, message: str, **extra: Any) -> dict[str, Any]:
    return {
        "job_id": _job_id(),
        "source": _source(),
        "status": status,
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "message": message,
        **extra,
    }


def _write_status(payload: dict[str, Any], client: Any = None, config: R2PublishConfig | None = None) -> None:
    relative_prefix = Path(_history_prefix())
    status_path = ROOT / "public" / "data" / relative_prefix / "jobs" / f"{_job_id()}.json"
    write_json_atomic(status_path, payload)
    if client is not None and config is not None:
        put_json_object(client, config, f"{_history_prefix()}/jobs/{_job_id()}.json", payload)


def _era5_bounds() -> RegionBounds:
    default = ERA5_DEFAULT_REGION
    return RegionBounds(
        west=float(os.getenv("ERA5_REGION_WEST", str(default.west))),
        south=float(os.getenv("ERA5_REGION_SOUTH", str(default.south))),
        east=float(os.getenv("ERA5_REGION_EAST", str(default.east))),
        north=float(os.getenv("ERA5_REGION_NORTH", str(default.north))),
    )


def _release_era5_lock(client: Any, config: R2PublishConfig) -> None:
    key = os.getenv("ERA5_ACTIVE_LOCK_KEY", "radar/history/era5/active.json").strip()
    existing, etag = get_json_object_with_etag(client, config, key)
    if not existing or existing.get("job_id") != _job_id() or not etag:
        return
    try:
        put_json_object(
            client,
            config,
            key,
            {
                "job_id": _job_id(),
                "source": "era5",
                "status": "complete",
                "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            if_match=etag,
        )
    except Exception as exc:
        if not is_precondition_failed(exc):
            raise


def _read_stage(path: Path) -> str | None:
    try:
        import json

        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    value = payload.get("stage") if isinstance(payload, dict) else None
    return str(value) if value else None


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )
    source = _source()
    if source not in {"krax", "mrms", "era5"}:
        LOGGER.error("Unsupported historical radar source %s", source)
        return 2
    start = parse_timestamp(os.environ["HISTORY_START"])
    end = parse_timestamp(os.environ["HISTORY_END"])
    max_frames = max(1, min(ERA5_MAX_FRAMES if source == "era5" else 90, int(os.getenv("HISTORY_MAX_FRAMES", "30"))))
    region_id = os.getenv("HISTORY_REGION_ID", "view").strip().lower() or "view"
    era5_region = _era5_bounds() if source == "era5" else None
    if source == "era5":
        if end - start > timedelta(hours=ERA5_MAX_HOURS):
            LOGGER.error("ERA5 historical range exceeds %d hours", ERA5_MAX_HOURS)
            return 2
        dataset_id = era5_dataset_id(start, end, region_id, era5_region)
    else:
        dataset_id = f"krax-{dataset_id_for_range(start, end)}" if source == "krax" else f"mrms-{region_id}-{dataset_id_for_range(start, end)}"
    config = R2PublishConfig.from_env()
    client = create_r2_client(config)
    source_label = "National MRMS" if source == "mrms" else "ERA5 hourly reanalysis" if source == "era5" else "KRAX Level II"
    if source == "era5":
        cached = get_json_object(client, config, f"{_history_prefix()}/{dataset_id}/manifest.json")
        if (
            isinstance(cached, dict)
            and cached.get("status") == "ready"
            and cached.get("source") == "era5"
            and cached.get("observed") is False
            and cached.get("era5_reconstruction_version") == 1
        ):
            _write_status(
                _status("complete", "Reused complete ERA5 dataset from R2 cache", dataset_id=dataset_id, manifest_url=f"{_history_prefix()}/{dataset_id}/manifest.json", stage="Complete", cache_hit=True),
                client,
                config,
            )
            _release_era5_lock(client, config)
            return 0
    _write_status(
        _status("running", f"{source_label} historical job started", dataset_id=dataset_id, stage="Queued"),
        client,
        config,
    )
    stage_file: Path | None = None
    try:
        script = (
            "build_historical_era5.py"
            if source == "era5"
            else "build_historical_krax.py"
            if source == "krax"
            else "build_historical_radar.py"
        )
        command = [
            sys.executable,
            str(ROOT / "scripts" / script),
            "--start",
            os.environ["HISTORY_START"],
            "--end",
            os.environ["HISTORY_END"],
            "--max-frames",
            str(max_frames),
        ]
        if source == "mrms":
            command.extend(["--region-id", region_id])
        if source == "era5":
            stage_file = ROOT / ".radar-tmp" / f"era5-history-{_job_id()}.json"
            stage_file.parent.mkdir(parents=True, exist_ok=True)
            command.extend(
                [
                    "--region-id",
                    region_id,
                    "--west",
                    str(era5_region.west),
                    "--south",
                    str(era5_region.south),
                    "--east",
                    str(era5_region.east),
                    "--north",
                    str(era5_region.north),
                    "--output-dir",
                    str(ROOT / "public" / "data" / "radar" / "history" / "era5"),
                    "--status-file",
                    str(stage_file),
                ]
            )
        process = subprocess.Popen(command, cwd=ROOT)
        last_stage: str | None = None
        while process.poll() is None:
            if stage_file is not None:
                current_stage = _read_stage(stage_file)
                if current_stage and current_stage != last_stage:
                    last_stage = current_stage
                    _write_status(_status("running", current_stage, dataset_id=dataset_id, stage=current_stage), client, config)
            time.sleep(1)
        return_code = process.wait()
        if return_code:
            _write_status(_status("failed", f"Historical processor exited with code {return_code}", dataset_id=dataset_id, stage="Failed"), client, config)
            if source == "era5":
                _release_era5_lock(client, config)
            return return_code
        _write_status(_status("running", "Uploading generated historical assets", dataset_id=dataset_id, stage="Uploading"), client, config)
        keys = publish_directory(
            client,
            config,
            ROOT / "public" / "data",
            include_prefixes=(_history_prefix(),),
        )
        manifest_url = f"{_history_prefix()}/{dataset_id}/manifest.json"
        _write_status(
            _status(
                "complete",
                f"Published {len(keys)} historical R2 objects",
                dataset_id=dataset_id,
                manifest_url=manifest_url,
                stage="Complete",
            ),
            client,
            config,
        )
        if source == "era5":
            _release_era5_lock(client, config)
        LOGGER.info("Historical dataset %s is ready", dataset_id)
        return 0
    except Exception as exc:
        LOGGER.exception("Cloud Run historical job failed")
        _write_status(_status("failed", str(exc), dataset_id=dataset_id, stage="Failed"), client, config)
        if source == "era5":
            try:
                _release_era5_lock(client, config)
            except Exception:
                LOGGER.exception("Unable to release ERA5 active-job lock")
        return 1
    finally:
        if stage_file is not None and stage_file.exists():
            stage_file.unlink()


if __name__ == "__main__":
    raise SystemExit(main())
