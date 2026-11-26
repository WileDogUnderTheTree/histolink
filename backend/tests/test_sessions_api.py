"""`/api/sessions` 接口测试（V1.0.6：前端历史记录真实持久化）。

覆盖：
- GET 列表 / POST 创建 / GET 详情 / PATCH 重命名置顶 / DELETE 删除全链路 + 冻结契约校验；
- 会话不存在 → 404 `SESSION_NOT_FOUND` envelope；
- PATCH 空请求体 → 400 `INVALID_REQUEST`（严格模型校验）；
- 只读闸门：会话管理是唯一新增写入口，其它 `/api` 写方法仍 405；
- `/api/agent/ask` 成功后把一轮问答持久化，前端刷新可恢复（详情含轮次 + 结构化回答快照）。
"""

from __future__ import annotations

from typing import Any

import jsonschema
import pytest
from agent_testkit import FakeLLM, final_step, grounded_answer, tool_call_step
from fastapi.testclient import TestClient

from routers.deps import get_llm_client

CHIBI_CITATION = "cite-handong-chibi-0"
ASK_BODY = {
    "question": "赤壁之战发生在哪一年？",
    "session_id": "session-api",
    "context": {"route": "/timeline"},
}


def _validate(instance: Any, model: str, spec: dict[str, Any]) -> None:
    jsonschema.Draft202012Validator(
        {**spec, "$ref": f"#/components/schemas/{model}"}
    ).validate(instance)


@pytest.fixture
def install_llm(client: TestClient):
    """安装 FakeLLM 依赖覆盖，用例结束后恢复。"""

    def _install(fake: FakeLLM) -> FakeLLM:
        client.app.dependency_overrides[get_llm_client] = lambda: fake
        return fake

    yield _install
    client.app.dependency_overrides.pop(get_llm_client, None)


def test_sessions_crud_全链路符合契约(
    client: TestClient, openapi_spec: dict[str, Any]
) -> None:
    # 初始为空（conftest 每个用例清空内存会话库）。
    listed = client.get("/api/sessions")
    assert listed.status_code == 200
    payload = listed.json()
    _validate(payload, "SessionListResponse", openapi_spec)
    assert payload["sessions"] == []

    # 创建：session_id 由调用方提供，保证前端刷新后 id 稳定。
    created = client.post(
        "/api/sessions", json={"session_id": "session-crud", "title": "冒烟会话"}
    )
    assert created.status_code == 200
    detail = created.json()
    _validate(detail, "SessionDetailResponse", openapi_spec)
    assert detail["session"]["session_id"] == "session-crud"
    assert detail["session"]["title"] == "冒烟会话"
    assert detail["session"]["turns"] == []
    assert detail["session"]["turn_count"] == 0

    # 重命名 + 置顶（PATCH 可同时提交两个字段）。
    patched = client.patch(
        "/api/sessions/session-crud", json={"title": "重命名后的会话", "pinned": True}
    )
    assert patched.status_code == 200
    mutation = patched.json()
    _validate(mutation, "SessionMutationResponse", openapi_spec)
    assert mutation["session"]["title"] == "重命名后的会话"
    assert mutation["session"]["pinned"] is True

    # 列表：置顶优先。
    listed = client.get("/api/sessions").json()
    _validate(listed, "SessionListResponse", openapi_spec)
    assert [item["session_id"] for item in listed["sessions"]] == ["session-crud"]

    # 详情。
    got = client.get("/api/sessions/session-crud")
    assert got.status_code == 200
    assert got.json()["session"]["title"] == "重命名后的会话"

    # 删除。
    deleted = client.delete("/api/sessions/session-crud")
    assert deleted.status_code == 200
    delete_payload = deleted.json()
    _validate(delete_payload, "SessionDeleteResponse", openapi_spec)
    assert delete_payload["session_id"] == "session-crud"
    assert client.get("/api/sessions/session-crud").status_code == 404


def test_create_带已存在session_id时幂等(client: TestClient) -> None:
    first = client.post(
        "/api/sessions", json={"session_id": "session-idem", "title": "标题一"}
    )
    second = client.post(
        "/api/sessions", json={"session_id": "session-idem", "title": "标题二"}
    )
    assert first.status_code == second.status_code == 200
    # 已存在时不覆盖原标题（幂等语义，避免刷新 / 重试把用户重命名结果冲掉）。
    assert second.json()["session"]["title"] == "标题一"
    assert len(client.get("/api/sessions").json()["sessions"]) == 1


def test_session_not_found_返回404统一信封(
    client: TestClient, openapi_spec: dict[str, Any]
) -> None:
    for response in (
        client.get("/api/sessions/missing"),
        client.patch("/api/sessions/missing", json={"title": "x"}),
        client.delete("/api/sessions/missing"),
    ):
        assert response.status_code == 404
        payload = response.json()
        assert payload["ok"] is False
        assert payload["error"]["code"] == "SESSION_NOT_FOUND"
        assert payload["error"]["details"]["session_id"] == "missing"
        _validate(payload, "ErrorEnvelope", openapi_spec)


def test_patch_空请求体返回400(client: TestClient) -> None:
    client.post("/api/sessions", json={"session_id": "session-patch"})
    response = client.patch("/api/sessions/session-patch", json={})
    assert response.status_code == 400
    payload = response.json()
    assert payload["error"]["code"] == "INVALID_REQUEST"


def test_只读闸门_只放行会话管理写入口(client: TestClient) -> None:
    # 会话管理：允许写。
    assert client.post("/api/sessions", json={}).status_code == 200
    assert client.patch("/api/sessions/none", json={"title": "x"}).status_code == 404
    # 其它 /api：写方法仍统一 405 envelope。
    for method, path in (
        ("post", "/api/meta"),
        ("patch", "/api/entities/person"),
        ("delete", "/api/meta"),
        ("put", "/api/sessions/session-x"),  # 路径合法但该方法未实现 → 405
    ):
        response = getattr(client, method)(path)
        assert response.status_code == 405, f"{method.upper()} {path}"
        assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_ask成功后持久化一轮问答并可在详情恢复(
    client: TestClient,
    install_llm: Any,
    openapi_spec: dict[str, Any],
) -> None:
    install_llm(
        FakeLLM(
            [
                tool_call_step("get_event", {"event_id": "handong-chibi"}),
                final_step(grounded_answer(citation_ids=[CHIBI_CITATION])),
            ]
        )
    )
    response = client.post("/api/agent/ask", json=ASK_BODY)
    assert response.status_code == 200
    assert response.json()["answer"]["mode"] == "grounded"

    detail_payload = client.get("/api/sessions/session-api")
    assert detail_payload.status_code == 200
    detail = detail_payload.json()["session"]
    _validate(detail_payload.json(), "SessionDetailResponse", openapi_spec)
    assert detail["turn_count"] == 2
    assert detail["title"] == "赤壁之战发生在哪一年？"
    user_turn, assistant_turn = detail["turns"]
    assert user_turn["role"] == "user"
    assert user_turn["content"] == "赤壁之战发生在哪一年？"
    assert user_turn["answer"] is None
    assert assistant_turn["role"] == "assistant"
    assert assistant_turn["content"]
    # 结构化回答快照：前端刷新后恢复引用 / 实体 / 联动动作等富文本内容。
    answer_payload = assistant_turn["answer"]
    assert answer_payload["answer"]["mode"] == "grounded"
    assert answer_payload["request_id"].startswith("req_")
    assert answer_payload["citations"][0]["id"] == CHIBI_CITATION
    assert answer_payload["trace"]["model_used"] == "fake-qwen"

    # 同一 session 的下一问能读到上一轮历史（多轮记忆生效的 API 级证据）。
    assert client.get("/api/sessions").json()["sessions"][0]["turn_count"] == 2


def test_ask失败不写入会话(install_llm: Any, client: TestClient) -> None:
    """LLM 超时 / 未配置时不允许在会话库留下半轮问答。"""

    from llm_client import LLMTimeoutError

    install_llm(FakeLLM([LLMTimeoutError("timeout")]))
    response = client.post(
        "/api/agent/ask", json={**ASK_BODY, "session_id": "session-fail"}
    )
    assert response.status_code == 504
    assert client.get("/api/sessions/session-fail").status_code == 404
    assert client.get("/api/sessions").json()["sessions"] == []
