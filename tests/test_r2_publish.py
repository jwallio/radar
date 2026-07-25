from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from radar_processing.r2 import (
    R2PublishConfig,
    cache_control_for,
    object_key,
    prune_old_frames,
    publish_directory,
    put_json_object,
)


class FakeR2:
    def __init__(self, objects=None):
        self.uploads = []
        self.objects = objects or []
        self.deleted = []
        self.puts = []

    def upload_file(self, filename, bucket, key, ExtraArgs):
        self.uploads.append((filename, bucket, key, ExtraArgs))

    def list_objects_v2(self, **kwargs):
        matches = [item for item in self.objects if item["Key"].startswith(kwargs["Prefix"])]
        return {"Contents": matches, "IsTruncated": False}

    def delete_objects(self, **kwargs):
        keys = [item["Key"] for item in kwargs["Delete"]["Objects"]]
        self.deleted.extend(keys)

    def put_object(self, **kwargs):
        self.puts.append(kwargs)


def config() -> R2PublishConfig:
    return R2PublishConfig(
        endpoint_url="https://account.r2.cloudflarestorage.com",
        bucket="radar",
        access_key_id="key",
        secret_access_key="secret",
        retain_days=3,
    )


def test_r2_keys_and_cache_headers() -> None:
    root = Path("public")
    assert object_key(Path("public/data/radar/manifest.json"), root) == "data/radar/manifest.json"
    assert cache_control_for(Path("manifest.json")).startswith("no-store")
    assert "immutable" in cache_control_for(Path("frame.png"))


def test_manifest_is_published_after_assets(tmp_path: Path) -> None:
    data = tmp_path / "public"
    (data / "data/radar/frames").mkdir(parents=True)
    (data / "data/radar/frames/frame.png").write_bytes(b"png")
    (data / "data/radar/manifest.json").write_text("{}", encoding="utf-8")
    client = FakeR2()

    keys = publish_directory(client, config(), data)

    assert keys == ["data/radar/frames/frame.png", "data/radar/manifest.json"]
    assert client.uploads[-1][2] == "data/radar/manifest.json"


def test_prune_old_live_frames_only() -> None:
    now = datetime(2026, 7, 25, tzinfo=timezone.utc)
    old = now - timedelta(days=4)
    client = FakeR2(
        [
            {"Key": "radar/frames/old.png", "LastModified": old},
            {"Key": "radar/krax/frames/new.png", "LastModified": now},
            {"Key": "radar/history/archive/old.png", "LastModified": old},
        ]
    )

    deleted = prune_old_frames(client, config(), now=now)

    assert deleted == ["radar/frames/old.png"]
    assert client.deleted == deleted


def test_live_worker_can_skip_history_payloads_but_publish_catalogs(tmp_path: Path) -> None:
    data = tmp_path / "public"
    (data / "data/radar/history/example/frames").mkdir(parents=True)
    (data / "data/radar/history/example/frames/frame.png").write_bytes(b"png")
    (data / "data/radar/history/catalog.json").write_text("{}", encoding="utf-8")
    (data / "data/radar/manifest.json").write_text("{}", encoding="utf-8")
    client = FakeR2()

    keys = publish_directory(
        client,
        config(),
        data,
        exclude_prefixes=("data/radar/history",),
        include_relative_paths=("data/radar/history/catalog.json",),
    )

    assert "data/radar/history/example/frames/frame.png" not in keys
    assert "data/radar/history/catalog.json" in keys


def test_include_prefixes_and_small_json_objects() -> None:
    client = FakeR2()
    put_json_object(client, config(), "control/polling.json", {"enabled": False})
    assert client.puts[0]["Key"] == "control/polling.json"
    assert client.puts[0]["ContentType"].startswith("application/json")


def test_include_prefixes_limits_history_publish(tmp_path: Path) -> None:
    data = tmp_path / "data"
    (data / "radar/krax/history/pack").mkdir(parents=True)
    (data / "radar/krax/history/pack/manifest.json").write_text("{}", encoding="utf-8")
    (data / "radar/krax/manifest.json").write_text("{}", encoding="utf-8")
    client = FakeR2()
    keys = publish_directory(client, config(), data, include_prefixes=("radar/krax/history",))
    assert keys == ["radar/krax/history/pack/manifest.json"]
