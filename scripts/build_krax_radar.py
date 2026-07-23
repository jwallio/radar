from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from radar_processing.config import load_nexrad_config  # noqa: E402
from radar_processing.nexrad import list_recent_volumes  # noqa: E402
from radar_processing.nexrad_pipeline import build_krax_dataset  # noqa: E402


LOGGER = logging.getLogger("wallcloud.radar.krax")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download and render recent completed KRAX NEXRAD Level II volume scans."
    )
    parser.add_argument("--max-frames", type=int, help="Override NEXRAD_MAX_FRAMES")
    parser.add_argument("--retention-minutes", type=int, help="Override NEXRAD_RETENTION_MINUTES")
    parser.add_argument("--keep-raw", action="store_true", help="Keep downloaded Level II files in .nexrad-raw")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    if args.max_frames is not None:
        os.environ["NEXRAD_MAX_FRAMES"] = str(args.max_frames)
    if args.retention_minutes is not None:
        os.environ["NEXRAD_RETENTION_MINUTES"] = str(args.retention_minutes)
    config = load_nexrad_config(ROOT, keep_raw=args.keep_raw)
    LOGGER.info(
        "Listing recent completed %s Level II volumes (max %d frames)",
        config.site,
        config.max_frames,
    )
    volumes = list_recent_volumes(config)
    if not volumes:
        raise RuntimeError("The public NEXRAD archive returned no recent KRAX volume scans")
    build_krax_dataset(
        config,
        volumes,
        output_dir=config.output_dir,
        mode="live",
        dataset_id="krax-live",
        label="KRAX Level II · Live / recent",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
