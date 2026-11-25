"""鍙 meta 鎺ュ彛娴嬭瘯锛圴1.0.1 / TC-06锛沄1.0.5.2 鐗堟湰鍙风粺涓€锛夈€?
楠屾敹锛歚/api/health` 杩斿洖 version=1.0.5.2锛沗/api/meta` 鐨?counts/hash 涓?`backend/data/snapshot.meta.json` 瀹屽叏涓€鑷达紱capabilities 鍚?5 涓?V1.0 鍔ㄤ綔绫诲瀷锛?鍝嶅簲鍙濂戠害 JSON Schema 鏍￠獙銆?"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema
from fastapi.testclient import TestClient

EXPECTED_ACTIONS = {
    "timeline.focus_event",
    "timeline.focus_dynasty",
    "graph.focus_person",
    "graph.focus_relation",
    "ask.suggest",
}


def _validate_against_contract(instance: Any, model: str, spec: dict[str, Any]) -> None:
    validator = jsonschema.Draft202012Validator({**spec, "$ref": f"#/components/schemas/{model}"})
    validator.validate(instance)


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["version"] == "1.0.5.2"


def test_meta_counts_and_hash_match_snapshot_meta(
    client: TestClient, repo_root: Path, openapi_spec: dict[str, Any]
) -> None:
    meta = json.loads((repo_root / "backend" / "data" / "snapshot.meta.json").read_text(encoding="utf-8"))
    response = client.get("/api/meta")
    assert response.status_code == 200
    payload = response.json()

    assert payload["ok"] is True
    assert payload["schema_version"] == "1.0"
    assert payload["api_version"] == "1.0.5.2"
    assert payload["snapshot"]["version"] == meta["snapshot_version"]
    assert payload["snapshot"]["hash"] == f"sha256:{meta['content_hash']}"
    assert payload["snapshot"]["counts"] == meta["counts"]

    # V1.0.5.4 起：计数基线只有一个来源（export-snapshot 生成的 data-counts.lock.json），
    # 数据扩充时由 backend/scripts/ingest_graph_data.py 统一刷新，测试不再硬编码魔法数字。
    counts_lock = json.loads(
        (
            repo_root / "frontend" / "data" / "locks" / "data-counts.lock.json"
        ).read_text(encoding="utf-8")
    )
    expected_counts = counts_lock["counts"]
    for key in ("events", "persons", "relations", "eras", "scopes", "groups", "aliases"):
        assert payload["snapshot"]["counts"][key] == expected_counts[key], (
            f"快照 counts.{key} 与 data-counts 锁不一致"
        )

    _validate_against_contract(payload, "MetaResponse", openapi_spec)


def test_meta_capabilities_cover_five_available_actions(client: TestClient) -> None:
    payload = client.get("/api/meta").json()
    assert set(payload["capabilities"]["actions"]) == EXPECTED_ACTIONS
    assert payload["capabilities"]["clarification"] is True


def test_meta_is_read_only(client: TestClient) -> None:
    assert client.post("/api/meta").status_code == 405
    assert client.put("/api/meta").status_code == 405
    assert client.delete("/api/meta").status_code == 405
