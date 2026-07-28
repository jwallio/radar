from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from radar_processing.config import PRODUCTS, load_config  # noqa: E402
from radar_processing.manifest import write_json_atomic  # noqa: E402
from radar_processing.mrms import list_product_frames, select_recent_frames  # noqa: E402
from radar_processing.national_tiles import build_national_mrms_dataset, select_incremental_frames  # noqa: E402
from radar_processing.pipeline import REFLECTIVITY_ID  # noqa: E402
from radar_processing.r2 import (  # noqa: E402
    R2PublishConfig,
    create_r2_client,
    get_json_object,
    publish_directory,
    prune_old_frames,
)


LOGGER = logging.getLogger("wallcloud.radar.cloudrun.mrms")


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )
    status_path = ROOT / "public" / "data" / "radar" / "mrms-worker-status.json"
    try:
        os.environ["MRMS_INCLUDE_PRECIP_TYPE"] = "false"
        config = load_config(ROOT)
        r2_config = R2PublishConfig.from_env()
        client = create_r2_client(r2_config)
        existing = get_json_object(client, r2_config, "radar/manifest.json")
        candidates = list_product_frames(PRODUCTS[REFLECTIVITY_ID], config)
        selected = select_recent_frames(
            candidates,
            retention_minutes=config.retention_minutes,
            max_frames=config.max_frames,
        )
        if not selected:
            raise RuntimeError("The official MRMS directory returned no reflectivity frames")
        selected = select_incremental_frames(selected, existing)
        manifest = build_national_mrms_dataset(
            config,
            selected,
            existing_manifest=existing,
            trust_existing_assets=True,
            min_zoom=max(0, int(os.getenv("MRMS_TILE_MIN_ZOOM", "3"))),
            max_zoom=max(1, int(os.getenv("MRMS_TILE_MAX_ZOOM", "8"))),
            workers=max(1, int(os.getenv("MRMS_TILE_WORKERS", "2"))),
        )
        write_json_atomic(
            status_path,
            {
                "worker": "wallcloud-national-mrms",
                "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "ok": True,
                "latest_valid_time": manifest.get("latest_valid_time"),
                "frame_count": len(manifest.get("frames", [])),
            },
        )
        keys = publish_directory(
            client,
            r2_config,
            ROOT / "public" / "data",
            include_relative_paths=("radar/manifest.json", "radar/mrms-worker-status.json"),
            include_prefixes=("radar/national",),
        )
        LOGGER.info("Published %d national MRMS objects", len(keys))
        LOGGER.info("Pruned %d expired live radar objects", len(prune_old_frames(client, r2_config)))
        return 0
    except Exception:
        LOGGER.exception("National MRMS refresh failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
