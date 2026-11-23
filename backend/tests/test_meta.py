"""只读 meta 接口测试（V1.0.1 / TC-06）。

验收：`/api/health` 返回 version=1.0.1；`/api/meta` 的 counts/hash 与
`backend/data/snapshot.meta.json` 完全一致；capabilities 含 5 个 V1.0 动作类型；
响应可被契约 JSON Schema 校验。
"""

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
    assert payload["version"] == "1.0.3"


def test_meta_counts_and_hash_match_snapshot_meta(
    client: TestClient, repo_root: Path, openapi_spec: dict[str, Any]
) -> None:
    meta = json.loads((repo_root / "backend" / "data" / "snapshot.meta.json").read_text(encoding="utf-8"))
    response = client.get("/api/meta")
    assert response.status_code == 200
    payload = response.json()

    assert payload["ok"] is True
    assert payload["schema_version"] == "1.0"
    assert payload["api_version"] == "1.0.1"
    assert payload["snapshot"]["version"] == meta["snapshot_version"]
    assert payload["snapshot"]["hash"] == f"sha256:{meta['content_hash']}"
    assert payload["snapshot"]["counts"] == meta["counts"]
    assert payload["snapshot"]["counts"]["events"] == 705
    assert payload["snapshot"]["counts"]["persons"] == 1058
    assert payload["snapshot"]["counts"]["relations"] == 639
    assert payload["snapshot"]["counts"]["eras"] == 18
    assert payload["snapshot"]["counts"]["scopes"] == 7
    assert payload["snapshot"]["counts"]["groups"] == 7
    assert payload["snapshot"]["counts"]["aliases"] == 66

    _validate_against_contract(payload, "MetaResponse", openapi_spec)


def test_meta_capabilities_cover_five_available_actions(client: TestClient) -> None:
    payload = client.get("/api/meta").json()
    assert set(payload["capabilities"]["actions"]) == EXPECTED_ACTIONS
    assert payload["capabilities"]["clarification"] is True


def test_meta_is_read_only(client: TestClient) -> None:
    assert client.post("/api/meta").status_code == 405
    assert client.put("/api/meta").status_code == 405
    assert client.delete("/api/meta").status_code == 405
