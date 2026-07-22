from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


def _parse_time(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def sort_frame_records(frames: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(frames, key=lambda frame: _parse_time(str(frame["valid_time"])))


def retain_frame_records(
    frames: Iterable[dict[str, Any]],
    *,
    retention_minutes: int,
    max_frames: int,
) -> list[dict[str, Any]]:
    ordered = sort_frame_records(frames)
    if not ordered:
        return []
    newest = _parse_time(str(ordered[-1]["valid_time"]))
    cutoff = newest - timedelta(minutes=retention_minutes)
    recent = [frame for frame in ordered if _parse_time(str(frame["valid_time"])) >= cutoff]
    return recent[-max_frames:]


def filter_existing_frames(frames: Iterable[dict[str, Any]], frame_dir: Path) -> list[dict[str, Any]]:
    """Drop manifest entries whose raster is missing instead of leaving a broken URL."""

    existing: list[dict[str, Any]] = []
    for frame in frames:
        filename = Path(str(frame.get("url", ""))).name
        if filename and (frame_dir / filename).is_file():
            existing.append(frame)
    return existing


def is_stale(
    latest_valid_time: str | None,
    *,
    now: datetime | None = None,
    max_age_minutes: int = 15,
) -> bool:
    if not latest_valid_time:
        return True
    reference = now.astimezone(timezone.utc) if now else datetime.now(timezone.utc)
    return reference - _parse_time(latest_valid_time) > timedelta(minutes=max_age_minutes)


def build_manifest(
    *,
    region: list[float],
    products: dict[str, dict[str, Any]],
    generated_at: str,
    sources: dict[str, str],
    errors: list[str] | None = None,
    mode: str = "live",
    dataset_id: str = "live",
    label: str = "Live / recent radar",
    start_time: str | None = None,
    end_time: str | None = None,
) -> dict[str, Any]:
    reflectivity = products.get("MergedReflectivityQCComposite", {})
    reflectivity_frames = sort_frame_records(reflectivity.get("frames", []))
    latest = reflectivity_frames[-1]["valid_time"] if reflectivity_frames else None
    return {
        "schema_version": 1,
        "status": "ready" if reflectivity_frames else "unavailable",
        "mode": mode,
        "dataset_id": dataset_id,
        "label": label,
        "generated_at": generated_at,
        "latest_valid_time": latest,
        "start_time": start_time or (reflectivity_frames[0]["valid_time"] if reflectivity_frames else None),
        "end_time": end_time or latest,
        "region": {
            "west": region[0],
            "south": region[1],
            "east": region[2],
            "north": region[3],
        },
        "product": "MergedReflectivityQCComposite",
        "products": products,
        "frames": reflectivity_frames,
        "sources": sources,
        "errors": errors or [],
    }


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, indent=2, sort_keys=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        temporary_path = Path(temporary_name)
        if temporary_path.exists():
            temporary_path.unlink()
