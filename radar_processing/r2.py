from __future__ import annotations

import mimetypes
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


PUBLISH_LAST_NAMES = frozenset(
    {"manifest.json", "catalog.json", "worker-status.json", "mrms-worker-status.json"}
)
PRUNE_PREFIXES = (
    "radar/frames/",
    "radar/national/frames/",
    "radar/national/previews/",
    "radar/focus/frames/",
    "radar/focus/previews/",
    "radar/krax/frames/",
    "radar/loops/",
    "radar/krax/loops/",
)


@dataclass(frozen=True)
class R2PublishConfig:
    endpoint_url: str
    bucket: str
    access_key_id: str
    secret_access_key: str
    object_prefix: str = ""
    retain_days: int = 3

    @classmethod
    def from_env(cls) -> "R2PublishConfig":
        required = {
            "R2_ENDPOINT_URL": os.getenv("R2_ENDPOINT_URL", "").strip(),
            "R2_BUCKET": os.getenv("R2_BUCKET", "").strip(),
            "R2_ACCESS_KEY_ID": os.getenv("R2_ACCESS_KEY_ID", "").strip(),
            "R2_SECRET_ACCESS_KEY": os.getenv("R2_SECRET_ACCESS_KEY", "").strip(),
        }
        missing = [name for name, value in required.items() if not value]
        if missing:
            raise RuntimeError(f"Missing R2 configuration: {', '.join(missing)}")
        try:
            retain_days = max(1, int(os.getenv("R2_RETAIN_DAYS", "3")))
        except ValueError as exc:
            raise ValueError("R2_RETAIN_DAYS must be an integer") from exc
        return cls(
            endpoint_url=required["R2_ENDPOINT_URL"].rstrip("/"),
            bucket=required["R2_BUCKET"],
            access_key_id=required["R2_ACCESS_KEY_ID"],
            secret_access_key=required["R2_SECRET_ACCESS_KEY"],
            object_prefix=_normalize_prefix(os.getenv("R2_OBJECT_PREFIX", "")),
            retain_days=retain_days,
        )


def _normalize_prefix(prefix: str) -> str:
    return prefix.strip("/") + "/" if prefix.strip("/") else ""


def object_key(local_path: Path, local_root: Path, object_prefix: str = "") -> str:
    relative = local_path.relative_to(local_root).as_posix()
    return f"{_normalize_prefix(object_prefix)}{relative}"


def cache_control_for(path: Path) -> str:
    if path.name in PUBLISH_LAST_NAMES:
        return "no-store, max-age=0, must-revalidate"
    if path.suffix.lower() in {".png", ".gif", ".webp"}:
        return "public, max-age=31536000, immutable"
    return "public, max-age=300"


def content_type_for(path: Path) -> str:
    known = {
        ".gif": "image/gif",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".pmtiles": "application/vnd.pmtiles",
        ".webp": "image/webp",
    }
    return known.get(path.suffix.lower(), mimetypes.guess_type(path.name)[0] or "application/octet-stream")


def ordered_publish_paths(local_root: Path) -> list[Path]:
    paths = sorted(path for path in local_root.rglob("*") if path.is_file())
    return sorted(paths, key=lambda path: (path.name in PUBLISH_LAST_NAMES, path.as_posix()))


def create_r2_client(config: R2PublishConfig) -> Any:
    try:
        import boto3
    except ImportError as exc:  # pragma: no cover - exercised by deployment setup
        raise RuntimeError("boto3 is required for R2 publishing; install requirements-vps.txt") from exc
    return boto3.client(
        "s3",
        endpoint_url=config.endpoint_url,
        region_name="auto",
        aws_access_key_id=config.access_key_id,
        aws_secret_access_key=config.secret_access_key,
    )


def publish_directory(
    client: Any,
    config: R2PublishConfig,
    local_root: Path,
    *,
    dry_run: bool = False,
    exclude_prefixes: tuple[str, ...] = (),
    include_relative_paths: tuple[str, ...] = (),
    include_prefixes: tuple[str, ...] = (),
) -> list[str]:
    uploaded: list[str] = []
    for path in ordered_publish_paths(local_root):
        relative = path.relative_to(local_root).as_posix()
        if include_prefixes and relative not in include_relative_paths and not any(
            relative == prefix.rstrip("/") or relative.startswith(prefix.rstrip("/") + "/")
            for prefix in include_prefixes
        ):
            continue
        excluded = any(relative.startswith(prefix.rstrip("/") + "/") for prefix in exclude_prefixes)
        if excluded and relative not in include_relative_paths:
            continue
        key = object_key(path, local_root, config.object_prefix)
        uploaded.append(key)
        if dry_run:
            continue
        client.upload_file(
            str(path),
            config.bucket,
            key,
            ExtraArgs={
                "ContentType": content_type_for(path),
                "CacheControl": cache_control_for(path),
            },
        )
    return uploaded


def put_json_object(
    client: Any,
    config: R2PublishConfig,
    key: str,
    payload: dict[str, Any],
    *,
    if_match: str | None = None,
) -> None:
    """Write a small control/status JSON object with no local temporary file."""
    import json

    object_key_name = f"{_normalize_prefix(config.object_prefix)}{key.lstrip('/')}"
    request: dict[str, Any] = {
        "Bucket": config.bucket,
        "Key": object_key_name,
        "Body": json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
        "ContentType": "application/json; charset=utf-8",
        "CacheControl": "no-store, max-age=0, must-revalidate",
    }
    if if_match:
        request["IfMatch"] = if_match
    client.put_object(**request)


def get_json_object_with_etag(
    client: Any,
    config: R2PublishConfig,
    key: str,
) -> tuple[dict[str, Any] | None, str | None]:
    """Read a small JSON object and its version tag, or two ``None`` values."""
    import json

    object_key_name = f"{_normalize_prefix(config.object_prefix)}{key.lstrip('/')}"
    try:
        response = client.get_object(Bucket=config.bucket, Key=object_key_name)
    except Exception as exc:  # boto3 exposes provider-specific not-found exceptions.
        error = getattr(exc, "response", {}).get("Error", {})
        if error.get("Code") in {"NoSuchKey", "404", "NotFound"}:
            return None, None
        raise
    body = response["Body"].read()
    parsed = json.loads(body)
    return (parsed if isinstance(parsed, dict) else None), response.get("ETag")


def get_json_object(client: Any, config: R2PublishConfig, key: str) -> dict[str, Any] | None:
    """Read a small JSON object, returning None when it does not exist."""
    payload, _etag = get_json_object_with_etag(client, config, key)
    return payload


def is_precondition_failed(exc: Exception) -> bool:
    """Return whether an S3-compatible write lost an ``If-Match`` race."""
    response = getattr(exc, "response", {})
    error = response.get("Error", {}) if isinstance(response, dict) else {}
    metadata = response.get("ResponseMetadata", {}) if isinstance(response, dict) else {}
    return error.get("Code") in {"PreconditionFailed", "412"} or metadata.get("HTTPStatusCode") == 412


def _iter_old_keys(client: Any, config: R2PublishConfig, cutoff: datetime) -> Iterable[str]:
    prefix_root = _normalize_prefix(config.object_prefix)
    for suffix in PRUNE_PREFIXES:
        prefix = f"{prefix_root}{suffix}"
        request: dict[str, Any] = {"Bucket": config.bucket, "Prefix": prefix}
        while True:
            response = client.list_objects_v2(**request)
            for item in response.get("Contents", []):
                modified = item.get("LastModified")
                if isinstance(modified, datetime) and modified.astimezone(timezone.utc) < cutoff:
                    yield str(item["Key"])
            if not response.get("IsTruncated"):
                break
            request["ContinuationToken"] = response["NextContinuationToken"]


def prune_old_frames(client: Any, config: R2PublishConfig, *, now: datetime | None = None) -> list[str]:
    reference = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    cutoff = reference - timedelta(days=config.retain_days)
    deleted: list[str] = []
    batch: list[dict[str, str]] = []
    for key in _iter_old_keys(client, config, cutoff):
        deleted.append(key)
        batch.append({"Key": key})
        if len(batch) == 1_000:
            client.delete_objects(Bucket=config.bucket, Delete={"Objects": batch})
            batch = []
    if batch:
        client.delete_objects(Bucket=config.bucket, Delete={"Objects": batch})
    return deleted
