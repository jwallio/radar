from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from radar_processing.config import RegionBounds  # noqa: E402
from radar_processing.era5 import (  # noqa: E402
    ERA5_DEFAULT_REGION,
    ERA5_MAX_FRAMES,
    build_era5_dataset,
    validate_era5_request,
)
from radar_processing.history import parse_timestamp  # noqa: E402
from radar_processing.manifest import write_json_atomic  # noqa: E402


LOGGER = logging.getLogger("wallcloud.radar.era5.history")


def _write_stage(path: Path | None, stage: str) -> None:
    if path is None:
        return
    write_json_atomic(
        path,
        {"stage": stage, "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")},
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a browser-ready hourly ERA5 precipitation reconstruction from the official CDS API."
    )
    parser.add_argument("--start", required=True, help="ISO-8601 UTC/Eastern start on a whole hour")
    parser.add_argument("--end", required=True, help="ISO-8601 UTC/Eastern end on a whole hour (exclusive)")
    parser.add_argument("--label", help="Optional viewer label")
    parser.add_argument("--region-id", default="current-view", help="Stable region label used in the dataset id")
    parser.add_argument("--west", type=float, default=None)
    parser.add_argument("--south", type=float, default=None)
    parser.add_argument("--east", type=float, default=None)
    parser.add_argument("--north", type=float, default=None)
    parser.add_argument("--max-frames", type=int, default=ERA5_MAX_FRAMES)
    parser.add_argument(
        "--output-dir",
        default=str(ROOT / "public" / "data" / "radar" / "history" / "era5"),
        help="Dataset/catalog output root; use .radar-tmp for local validation",
    )
    parser.add_argument("--status-file", type=Path, help="Optional stage marker used by the Cloud Run parent job")
    parser.add_argument("--keep-raw", action="store_true", help="Keep downloaded GRIB files in .era5-raw")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )

    status_file = args.status_file.resolve() if args.status_file else None
    try:
        start = parse_timestamp(args.start)
        end = parse_timestamp(args.end)
        default = ERA5_DEFAULT_REGION
        bounds = RegionBounds(
            west=args.west if args.west is not None else float(os.getenv("ERA5_REGION_WEST", default.west)),
            south=args.south if args.south is not None else float(os.getenv("ERA5_REGION_SOUTH", default.south)),
            east=args.east if args.east is not None else float(os.getenv("ERA5_REGION_EAST", default.east)),
            north=args.north if args.north is not None else float(os.getenv("ERA5_REGION_NORTH", default.north)),
        )
        validate_era5_request(start, end, bounds, max_frames=args.max_frames)
        output_root = Path(args.output_dir)
        if not output_root.is_absolute():
            output_root = ROOT / output_root
        manifest = build_era5_dataset(
            root=ROOT,
            output_root=output_root,
            start=start,
            end=end,
            bounds=bounds,
            region_id=args.region_id,
            max_frames=args.max_frames,
            label=args.label,
            keep_raw=args.keep_raw,
            stage_callback=lambda stage: _write_stage(status_file, stage),
        )
        LOGGER.info(
            "ERA5 dataset %s is ready with %d hourly frames",
            manifest["dataset_id"],
            len(manifest.get("frames", [])),
        )
        return 0
    except Exception as exc:  # noqa: BLE001 - Cloud Run parent records the failed stage
        _write_stage(status_file, "Failed")
        LOGGER.exception("ERA5 historical reconstruction failed: %s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
