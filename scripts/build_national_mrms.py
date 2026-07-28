from __future__ import annotations

import argparse
import logging
import os
import sys
from dataclasses import replace
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from radar_processing.config import PRODUCTS, load_config  # noqa: E402
from radar_processing.mrms import list_product_frames, select_recent_frames  # noqa: E402
from radar_processing.national_tiles import build_national_mrms_dataset, load_manifest  # noqa: E402
from radar_processing.pipeline import REFLECTIVITY_ID  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Build national CONUS MRMS PMTiles frames.")
    parser.add_argument("--max-frames", type=int, default=None)
    parser.add_argument("--retention-minutes", type=int, default=None)
    parser.add_argument("--min-zoom", type=int, default=3)
    parser.add_argument("--max-zoom", type=int, default=8)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Write generated data outside public/data/radar (useful for validation).",
    )
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    if args.max_frames is not None:
        os.environ["MRMS_MAX_FRAMES"] = str(args.max_frames)
    if args.retention_minutes is not None:
        os.environ["MRMS_RETENTION_MINUTES"] = str(args.retention_minutes)
    os.environ["MRMS_INCLUDE_PRECIP_TYPE"] = "false"
    config = load_config(ROOT)
    if args.output_dir is not None:
        output_dir = args.output_dir.resolve()
        config = replace(config, output_dir=output_dir, frame_dir=output_dir / "frames")
    candidates = list_product_frames(PRODUCTS[REFLECTIVITY_ID], config)
    selected = select_recent_frames(
        candidates,
        retention_minutes=config.retention_minutes,
        max_frames=config.max_frames,
    )
    if not selected:
        raise RuntimeError("The official MRMS directory returned no national reflectivity frames")
    build_national_mrms_dataset(
        config,
        selected,
        existing_manifest=load_manifest(config.output_dir / "manifest.json"),
        min_zoom=args.min_zoom,
        max_zoom=args.max_zoom,
        workers=args.workers,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
