from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from radar_processing.r2 import R2PublishConfig, create_r2_client, publish_directory, prune_old_frames  # noqa: E402


LOGGER = logging.getLogger("wallcloud.radar.r2")


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish generated radar data to Cloudflare R2.")
    parser.add_argument("--root", type=Path, default=ROOT, help="Repository root containing public/data")
    parser.add_argument("--dry-run", action="store_true", help="List keys without uploading or deleting")
    parser.add_argument("--no-prune", action="store_true", help="Do not delete old live frames from R2")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    config = R2PublishConfig.from_env()
    local_root = args.root.resolve() / "public" / "data"
    if not local_root.is_dir():
        raise RuntimeError(f"Radar data directory does not exist: {local_root}")
    client = create_r2_client(config)
    keys = publish_directory(client, config, local_root, dry_run=args.dry_run)
    LOGGER.info("%s %d R2 objects", "Would publish" if args.dry_run else "Published", len(keys))
    if not args.dry_run and not args.no_prune:
        deleted = prune_old_frames(client, config)
        LOGGER.info("Pruned %d old live R2 objects", len(deleted))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
