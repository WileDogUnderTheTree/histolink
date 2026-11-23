"""错误 envelope 与只读约束测试（V1.0.1 / TC-06）。

验收：404/405/503 走统一 envelope；非法参数 400；未知 id 不出现 500。
"""

from __future__ import annotations

from typing import Any

import jsonschema
from fastapi.testclient import TestClient


def _validate_error(payload: dict[str, Any], spec: dict[str, Any]) -> None:
    validator = jsonschema.Draft202012Validator({**spec, "$ref": "#/components/schemas/ErrorEnvelope"})
    validator.validate(payload)


def test_unknown_person_returns_404_envelope(client: TestClient, openapi_spec: dict[str, Any]) -> None:
    response = client.get("/api/entities/person/p-does-not-exist-0000")
    assert response.status_code == 404
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ENTITY_NOT_FOUND"
    assert payload["error"]["details"]["person_id"] == "p-does-not-exist-0000"
    assert payload["request_id"]
    _validate_error(payload, openapi_spec)


def test_unknown_event_returns_404_envelope(client: TestClient) -> None:
    response = client.get("/api/entities/event/no-such-event")
    assert response.status_code == 404
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ENTITY_NOT_FOUND"
    assert payload["error"]["details"]["event_id"] == "no-such-event"


def test_write_method_returns_405_envelope(client: TestClient, openapi_spec: dict[str, Any]) -> None:
    response = client.post("/api/entities/person", json={"person_id": "x"})
    assert response.status_code == 405
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "METHOD_NOT_ALLOWED"
    assert "allow" in {header.lower() for header in response.headers}
    _validate_error(payload, openapi_spec)


def test_delete_is_rejected(client: TestClient) -> None:
    for api_path in ["/api/meta", "/api/entities/event/xixia-09", "/api/entities/person/p-liangtaihou-xixia-0d0f"]:
        response = client.delete(api_path)
        assert response.status_code == 405, api_path
        assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_missing_query_param_returns_400_envelope(client: TestClient) -> None:
    response = client.get("/api/entities/persons")
    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "INVALID_REQUEST"
    assert payload["error"]["details"]["errors"]


def test_limit_out_of_range_returns_400(client: TestClient) -> None:
    response = client.get("/api/entities/persons", params={"name": "梁太后", "limit": 999})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_REQUEST"


def test_unknown_route_returns_404_envelope(client: TestClient) -> None:
    response = client.get("/api/nope")
    assert response.status_code == 404
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ROUTE_NOT_FOUND"


def test_snapshot_not_loaded_returns_503(client: TestClient) -> None:
    app = client.app
    original = app.state.store
    app.state.store = None
    try:
        response = client.get("/api/meta")
        assert response.status_code == 503
        payload = response.json()
        assert payload["ok"] is False
        assert payload["error"]["code"] == "SNAPSHOT_NOT_LOADED"
        assert payload["error"]["retryable"] is True
    finally:
        app.state.store = original


def test_no_write_endpoints_in_openapi(openapi_spec: dict[str, Any]) -> None:
    methods = set()
    for path_item in openapi_spec["paths"].values():
        methods.update(path_item.keys())
    assert "delete" not in methods
    assert "put" not in methods
    assert "patch" not in methods
