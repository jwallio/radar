from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from radar_processing.config import load_config  # noqa: E402
from radar_processing.observations import build_buoy_observations  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Wall Cloud's static NOAA NDBC buoy overlay feed.")
    parser.add_argument("--limit", type=int, default=30, help="Maximum active stations to query")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    config = load_config(ROOT)
    result = build_buoy_observations(config, ROOT / "public" / "data" / "observations" / "buoys.json", limit=args.limit)
    return 0 if result["status"] == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(main())
