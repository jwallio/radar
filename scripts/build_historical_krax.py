from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from radar_processing.config import load_nexrad_config  # noqa: E402
from radar_processing.history import (  # noqa: E402
    catalog_entry,
    dataset_id_for_range,
    parse_timestamp,
    update_history_catalog,
)
from radar_processing.nexrad import list_archive_volumes, sample_volumes  # noqa: E402
from radar_processing.nexrad_pipeline import build_krax_dataset  # noqa: E402


LOGGER = logging.getLogger("wallcloud.radar.krax.history")
EASTERN = ZoneInfo("America/New_York")


def _label(start, end) -> str:
    start_et = start.astimezone(EASTERN)
    end_et = end.astimezone(EASTERN)
    start_clock = start_et.strftime("%I:%M %p").lstrip("0")
    end_clock = end_et.strftime("%I:%M %p").lstrip("0")
    return f"KRAX · {start_et:%b %d, %Y} · {start_clock}–{end_clock} ET"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a browser-ready historical KRAX Level II loop from NOAA's public archive."
    )
    parser.add_argument("--start", required=True, help="ISO-8601 start with timezone")
    parser.add_argument("--end", required=True, help="ISO-8601 end with timezone")
    parser.add_argument("--label", help="Optional viewer label")
    parser.add_argument("--max-frames", type=int, default=30, help="Maximum evenly sampled volumes")
    parser.add_argument("--keep-raw", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    start = parse_timestamp(args.start)
    end = parse_timestamp(args.end)
    if start >= end:
        parser.error("--start must be before --end")
    if end - start > timedelta(hours=24):
        parser.error("Historical KRAX ranges are limited to 24 hours per generated pack")
    if not 1 <= args.max_frames <= 90:
        parser.error("--max-frames must be between 1 and 90")

    os.environ["NEXRAD_MAX_FRAMES"] = str(args.max_frames)
    config = load_nexrad_config(ROOT, keep_raw=args.keep_raw)
    LOGGER.info("Listing KRAX archive from %s through %s", start.isoformat(), end.isoformat())
    volumes = sample_volumes(
        list_archive_volumes(config, start=start, end=end),
        config.max_frames,
    )
    if not volumes:
        raise RuntimeError("The public NEXRAD archive returned no KRAX volumes for that range")

    dataset_id = f"krax-{dataset_id_for_range(start, end)}"
    output_dir = config.history_dir / dataset_id
    manifest = build_krax_dataset(
        config,
        volumes,
        output_dir=output_dir,
        mode="historical",
        dataset_id=dataset_id,
        label=args.label or _label(start, end),
        start_time=start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        end_time=end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    catalog = update_history_catalog(
        config.history_dir / "catalog.json",
        catalog_entry(manifest),
        max_entries=24,
    )
    LOGGER.info("KRAX historical pack %s is ready; catalog contains %d pack(s)", dataset_id, len(catalog["datasets"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
