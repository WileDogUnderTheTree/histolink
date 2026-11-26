"""快照加载 / fail-fast 测试（V1.0.1 / TC-06）。"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from snapshot_store import SnapshotLoadError, SnapshotStore


def _copy_snapshot(src_dir: Path, dst_dir: Path) -> tuple[Path, Path]:
    snapshot = dst_dir / "snapshot.v1.json"
    meta = dst_dir / "snapshot.meta.json"
    shutil.copyfile(src_dir / "snapshot.v1.json", snapshot)
    shutil.copyfile(src_dir / "snapshot.meta.json", meta)
    return snapshot, meta


def _data_counts_lock(repo_root: Path) -> dict:
    """读取全量冻结计数锁（V1.0.5.4 起由 export-snapshot 生成）。"""

    return json.loads(
        (repo_root / "frontend" / "data" / "locks" / "data-counts.lock.json").read_text(
            encoding="utf-8"
        )
    )


def test_load_real_snapshot(repo_root: Path) -> None:
    data_dir = repo_root / "backend" / "data"
    store = SnapshotStore.load(
        data_dir / "snapshot.v1.json", data_dir / "snapshot.meta.json"
    )
    expected = _data_counts_lock(repo_root)["counts"]
    assert store.meta["counts"]["events"] == expected["events"]
    assert store.snapshot_meta.hash.startswith("sha256:")
    assert len(store.persons_by_id) == expected["persons"]
    assert len(store.events_by_id) == expected["events"]


def test_missing_snapshot_fails_fast(tmp_path: Path) -> None:
    with pytest.raises(SnapshotLoadError, match="不存在"):
        SnapshotStore.load(
            tmp_path / "snapshot.v1.json", tmp_path / "snapshot.meta.json"
        )


def test_tampered_snapshot_is_rejected(repo_root: Path, tmp_path: Path) -> None:
    data_dir = repo_root / "backend" / "data"
    snapshot, meta = _copy_snapshot(data_dir, tmp_path)

    payload = json.loads(snapshot.read_text(encoding="utf-8"))
    payload["events"][0]["title"] = payload["events"][0]["title"] + "（被手改）"
    snapshot.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    with pytest.raises(SnapshotLoadError, match="hash"):
        SnapshotStore.load(snapshot, meta)


def test_counts_mismatch_is_rejected(repo_root: Path, tmp_path: Path) -> None:
    data_dir = repo_root / "backend" / "data"
    snapshot, meta = _copy_snapshot(data_dir, tmp_path)

    meta_payload = json.loads(meta.read_text(encoding="utf-8"))
    meta_payload["counts"]["events"] = 999
    meta.write_text(
        json.dumps(meta_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    with pytest.raises(SnapshotLoadError, match="counts"):
        SnapshotStore.load(snapshot, meta)


def test_invalid_json_is_rejected(repo_root: Path, tmp_path: Path) -> None:
    data_dir = repo_root / "backend" / "data"
    snapshot, meta = _copy_snapshot(data_dir, tmp_path)
    snapshot.write_text("{not json", encoding="utf-8")
    with pytest.raises(SnapshotLoadError, match="JSON"):
        SnapshotStore.load(snapshot, meta)
