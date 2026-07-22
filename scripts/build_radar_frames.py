from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from radar_processing.config import ANALYSIS_PRODUCT_IDS, PRODUCTS, ProcessingConfig, load_config  # noqa: E402
from radar_processing.mrms import RemoteFrame, list_product_frames, select_recent_frames  # noqa: E402
from radar_processing.observations import build_buoy_observations  # noqa: E402
from radar_processing.pipeline import PRECIP_ID, REFLECTIVITY_ID, build_radar_dataset  # noqa: E402


LOGGER = logging.getLogger("wallcloud.radar")


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )


def _process(config: ProcessingConfig) -> int:
    LOGGER.info(
        "Fetching recent MRMS listings for %s (max %d frames)",
        config.region.as_list(),
        config.max_frames,
    )
    reflectivity_candidates = list_product_frames(PRODUCTS[REFLECTIVITY_ID], config)
    reflectivity_frames = select_recent_frames(
        reflectivity_candidates,
        retention_minutes=config.retention_minutes,
        max_frames=config.max_frames,
    )
    if not reflectivity_frames:
        raise RuntimeError("The official MRMS reflectivity directory returned no timestamped frames")

    precip_candidates: list[RemoteFrame] = []
    if config.include_precip_type:
        try:
            precip_candidates = list_product_frames(PRODUCTS[PRECIP_ID], config)
        except RuntimeError as exc:
            LOGGER.warning("PrecipFlag listing unavailable; mode will be disabled: %s", exc)

    auxiliary_frames: dict[str, RemoteFrame] = {}
    for product_id in ANALYSIS_PRODUCT_IDS:
        try:
            candidates = list_product_frames(PRODUCTS[product_id], config)
            selected = select_recent_frames(
                candidates,
                retention_minutes=config.retention_minutes,
                max_frames=1,
            )
            if selected:
                auxiliary_frames[product_id] = selected[-1]
            else:
                LOGGER.warning("No current MRMS frame available for %s", product_id)
        except RuntimeError as exc:
            LOGGER.warning("%s listing unavailable; layer will be marked unavailable: %s", product_id, exc)

    sources = {
        "mrms_directory": config.mrms_base_url,
    }
    sources.update(
        {
            product_id: f"{config.mrms_base_url}/{PRODUCTS[product_id].directory}/"
            for product_id in PRODUCTS
        }
    )
    # Keep descriptive aliases for older consumers of the generated manifest.
    sources["reflectivity"] = sources[REFLECTIVITY_ID]
    sources["precip_flag"] = sources[PRECIP_ID]
    build_radar_dataset(
        config,
        reflectivity_frames,
        precip_candidates,
        output_dir=config.output_dir,
        mode="live",
        dataset_id="live",
        label="Live / recent radar",
        sources=sources,
        auxiliary_frames=auxiliary_frames,
    )
    try:
        build_buoy_observations(
            config,
            config.root / "public" / "data" / "observations" / "buoys.json",
        )
    except Exception as exc:  # noqa: BLE001 - observations are optional to the radar refresh
        LOGGER.warning("NDBC buoy refresh failed; preserving radar output: %s", exc)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Download and render a regional Wall Cloud MRMS frame sequence.")
    parser.add_argument("--max-frames", type=int, help="Override MRMS_MAX_FRAMES for this run")
    parser.add_argument("--retention-minutes", type=int, help="Override MRMS_RETENTION_MINUTES for this run")
    parser.add_argument("--no-precip-type", action="store_true", help="Skip the optional MRMS PrecipFlag product")
    parser.add_argument("--keep-raw", action="store_true", help="Keep downloaded GRIB2 files in .radar-raw")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    args = parser.parse_args()
    _configure_logging(args.verbose)

    if args.max_frames is not None:
        os.environ["MRMS_MAX_FRAMES"] = str(args.max_frames)
    if args.retention_minutes is not None:
        os.environ["MRMS_RETENTION_MINUTES"] = str(args.retention_minutes)
    if args.no_precip_type:
        os.environ["MRMS_INCLUDE_PRECIP_TYPE"] = "false"

    config = load_config(ROOT, keep_raw=args.keep_raw)
    return _process(config)


if __name__ == "__main__":
    raise SystemExit(main())
