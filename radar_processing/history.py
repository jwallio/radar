from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .manifest import write_json_atomic


def parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError(f"Timestamp must include a timezone: {value!r}")
    return parsed.astimezone(timezone.utc)


def dataset_id_for_range(start: datetime, end: datetime) -> str:
    start_token = start.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")
    end_token = end.astimezone(timezone.utc).strftime("%Y%m%dT%H%MZ")
    return f"{start_token}-{end_token}"


def catalog_entry(manifest: dict[str, Any]) -> dict[str, Any]:
    products = [
        product_id
        for product_id, product in manifest.get("products", {}).items()
        if product.get("frames")
    ]
    entry = {
        "id": manifest["dataset_id"],
        "label": manifest["label"],
        "start_time": manifest.get("start_time"),
        "end_time": manifest.get("end_time"),
        "frame_count": len(manifest.get("frames", [])),
        "products": products,
        "manifest_url": f"./{manifest['dataset_id']}/manifest.json",
    }
    for key in (
        "source",
        "source_type",
        "observed",
        "temporal_resolution",
        "native_resolution",
        "product_type",
        "era5_reconstruction_version",
        "mrms_product_tier",
        "mrms_archive_start",
        "mrms_full_suite_start",
        "mrms_full_suite",
        "region_id",
    ):
        if key in manifest:
            entry[key] = manifest[key]
    bounds = manifest.get("bounds")
    if not isinstance(bounds, list):
        region = manifest.get("region")
        if isinstance(region, dict):
            bounds = [region.get("west"), region.get("south"), region.get("east"), region.get("north")]
    if isinstance(bounds, list) and len(bounds) == 4 and all(isinstance(value, (int, float)) for value in bounds):
        entry["bounds"] = [float(value) for value in bounds]
    if manifest.get("site"):
        entry["site"] = manifest["site"]
    return entry


def update_history_catalog(
    catalog_path: Path,
    entry: dict[str, Any],
    *,
    max_entries: int | None = None,
) -> dict[str, Any]:
    datasets: list[dict[str, Any]] = []
    if catalog_path.is_file():
        try:
            loaded = json.loads(catalog_path.read_text(encoding="utf-8"))
            datasets = list(loaded.get("datasets", []))
        except (json.JSONDecodeError, OSError, TypeError):
            datasets = []
    datasets = [dataset for dataset in datasets if dataset.get("id") != entry.get("id")]
    datasets.append(entry)
    datasets.sort(key=lambda dataset: str(dataset.get("start_time") or ""), reverse=True)
    if max_entries is not None:
        if max_entries < 1:
            raise ValueError("max_entries must be positive when provided")
        datasets = datasets[:max_entries]
    catalog = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "datasets": datasets,
    }
    write_json_atomic(catalog_path, catalog)
    return catalog
