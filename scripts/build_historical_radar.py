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

from radar_processing.config import PRODUCTS, load_config  # noqa: E402
from radar_processing.history import (  # noqa: E402
    catalog_entry,
    dataset_id_for_range,
    parse_timestamp,
    update_history_catalog,
)
from radar_processing.mrms import list_archive_frames, sample_frames  # noqa: E402
from radar_processing.pipeline import PRECIP_ID, REFLECTIVITY_ID, build_radar_dataset  # noqa: E402


LOGGER = logging.getLogger("wallcloud.radar.history")
EASTERN = ZoneInfo("America/New_York")


def _default_label(start, end) -> str:
    start_et = start.astimezone(EASTERN)
    end_et = end.astimezone(EASTERN)
    start_clock = start_et.strftime("%I:%M %p").lstrip("0")
    end_clock = end_et.strftime("%I:%M %p").lstrip("0")
    return f"{start_et:%b %d, %Y} · {start_clock}–{end_clock} ET"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a browser-ready historical MRMS loop from NOAA's public NODD archive."
    )
    parser.add_argument("--start", required=True, help="ISO-8601 start with timezone, for example 2025-06-19T14:00:00-04:00")
    parser.add_argument("--end", required=True, help="ISO-8601 end with timezone")
    parser.add_argument("--label", help="Optional label shown in the viewer")
    parser.add_argument("--max-frames", type=int, default=45, help="Maximum evenly sampled frames (default: 45)")
    parser.add_argument("--no-precip-type", action="store_true", help="Skip historical PrecipFlag processing")
    parser.add_argument("--keep-raw", action="store_true", help="Keep downloaded GRIB2 files in .radar-raw")
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
        parser.error("Historical loop ranges are limited to 24 hours")
    if not 1 <= args.max_frames <= 90:
        parser.error("--max-frames must be between 1 and 90")

    os.environ["MRMS_MAX_FRAMES"] = str(args.max_frames)
    if args.no_precip_type:
        os.environ["MRMS_INCLUDE_PRECIP_TYPE"] = "false"
    config = load_config(ROOT, keep_raw=args.keep_raw)

    LOGGER.info("Listing NOAA MRMS archive from %s through %s", start.isoformat(), end.isoformat())
    reflectivity_candidates = list_archive_frames(
        PRODUCTS[REFLECTIVITY_ID],
        config,
        start=start,
        end=end,
    )
    reflectivity_frames = sample_frames(reflectivity_candidates, config.max_frames)
    if not reflectivity_frames:
        raise RuntimeError("NOAA's MRMS archive returned no reflectivity frames for that range")

    precip_candidates = []
    if config.include_precip_type:
        try:
            precip_candidates = list_archive_frames(
                PRODUCTS[PRECIP_ID],
                config,
                start=start,
                end=end,
            )
        except RuntimeError as exc:
            LOGGER.warning("Historical PrecipFlag unavailable; reflectivity will still be built: %s", exc)

    dataset_id = dataset_id_for_range(start, end)
    history_root = config.output_dir / "history"
    output_dir = history_root / dataset_id
    sources = {
        "mrms_archive": config.mrms_archive_base_url,
    }
    sources.update(
        {
            product_id: f"{config.mrms_archive_base_url}/{PRODUCTS[product_id].archive_prefix}/"
            for product_id in PRODUCTS
        }
    )
    sources["reflectivity"] = sources[REFLECTIVITY_ID]
    sources["precip_flag"] = sources[PRECIP_ID]
    manifest = build_radar_dataset(
        config,
        reflectivity_frames,
        precip_candidates,
        output_dir=output_dir,
        mode="historical",
        dataset_id=dataset_id,
        label=args.label or _default_label(start, end),
        sources=sources,
        start_time=start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        end_time=end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    catalog = update_history_catalog(history_root / "catalog.json", catalog_entry(manifest))
    LOGGER.info("Historical dataset %s is ready; catalog now contains %d loop(s)", dataset_id, len(catalog["datasets"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
