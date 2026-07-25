from __future__ import annotations

import argparse
try:
    import fcntl
except ImportError:  # pragma: no cover - Windows uses the processors directly.
    fcntl = None  # type: ignore[assignment]
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

from radar_processing.manifest import write_json_atomic  # noqa: E402
from radar_processing.control import fetch_polling_enabled  # noqa: E402
from radar_processing.r2 import R2PublishConfig, create_r2_client, publish_directory, prune_old_frames  # noqa: E402


LOGGER = logging.getLogger("wallcloud.radar.worker")


def _run_processor(label: str, script_name: str) -> dict[str, Any]:
    LOGGER.info("Starting %s processor", label)
    result = subprocess.run([sys.executable, str(ROOT / "scripts" / script_name)], cwd=ROOT, check=False)
    status: dict[str, Any] = {"ok": result.returncode == 0, "exit_code": result.returncode}
    if result.returncode == 0:
        LOGGER.info("%s processor completed", label)
    else:
        LOGGER.error("%s processor failed with exit code %d", label, result.returncode)
    return status


def _write_worker_status(components: dict[str, dict[str, Any]]) -> Path:
    status_path = ROOT / "public" / "data" / "radar" / "worker-status.json"
    payload = {
        "worker": "wallcloud-radar-vps",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ok": any(item["ok"] for item in components.values()),
        "components": components,
    }
    write_json_atomic(status_path, payload)
    return status_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh Wall Cloud radar data and publish it to R2.")
    parser.add_argument("--skip-mrms", action="store_true")
    parser.add_argument("--skip-krax", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Run processors but do not upload to R2")
    parser.add_argument("--no-prune", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )
    if fcntl is None:
        LOGGER.error("The VPS worker requires POSIX file locking; run it on Linux or macOS")
        return 1
    try:
        polling_enabled = fetch_polling_enabled()
    except RuntimeError as exc:
        LOGGER.error("%s", exc)
        return 1
    if not polling_enabled:
        LOGGER.info("Five-minute radar polling is disabled; archive/GIF processing remains available")
        return 0
    lock_path = Path(os.getenv("RADAR_WORKER_LOCK_PATH", str(ROOT / ".radar-tmp" / "refresh.lock")))
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            LOGGER.warning("Another radar refresh is already running; exiting cleanly")
            return 0

        components: dict[str, dict[str, Any]] = {}
        if not args.skip_mrms:
            components["mrms"] = _run_processor("MRMS", "build_radar_frames.py")
        if not args.skip_krax:
            components["krax"] = _run_processor("KRAX Level II", "build_krax_radar.py")
        status_path = _write_worker_status(components)

        try:
            config = R2PublishConfig.from_env()
            client = create_r2_client(config)
            keys = publish_directory(
                client,
                config,
                ROOT / "public" / "data",
                dry_run=args.dry_run,
                exclude_prefixes=("radar/history", "radar/krax/history"),
                include_relative_paths=("radar/history/catalog.json", "radar/krax/history/catalog.json"),
            )
            LOGGER.info("%s %d R2 objects", "Would publish" if args.dry_run else "Published", len(keys))
            if not args.dry_run and not args.no_prune:
                LOGGER.info("Pruned %d old live R2 objects", len(prune_old_frames(client, config)))
        except Exception:
            LOGGER.exception("R2 publish failed; local radar artifacts were retained")
            return 1
        finally:
            if args.dry_run:
                LOGGER.info("Worker status written to %s", status_path)

        return 0 if any(item["ok"] for item in components.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
