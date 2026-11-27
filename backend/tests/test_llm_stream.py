"""`llm_stream` 流式客户端单测（V1.0.6.2，全离线）。

用假 OpenAI SDK 客户端验证：
- 请求参数（stream=True / reasoning_effort / max_tokens / model）；
- content 内 思考标签（含跨 chunk 切断）被过滤，delta 只含最终答案；
- `delta.reasoning` 扩展字段被丢弃，只统计字符数；
- 只有思考没有最终答案 / 完全空回答 → `LLMUpstreamError`；
- OpenAI SDK 连接错误 / HTTP 错误 → 映射成项目内 `LLM*` 异常；
- 配置解析（auto 模式下本机地址关闭思考、显式 off 不发送参数）；
- SSE 帧编码与直答 messages 组装。
"""

from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace
from typing import Any

import httpx
import openai
import pytest

from llm_client import LLMConfigError, LLMUpstreamError
from llm_stream import (
    StreamChatClient,
    StreamSettings,
    build_direct_chat_messages,
    load_stream_settings,
    sse_event,
)

MODEL = "hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M"


def _settings(**overrides: Any) -> StreamSettings:
    base = StreamSettings(
        api_key="ollama",
        base_url="http://localhost:11434/v1",
        model=MODEL,
        fallback_model=None,
        timeout_seconds=30.0,
        max_tokens=256,
        reasoning_effort="none",
        system_prompt="TEST SYSTEM",
    )
    return replace(base, **overrides)


def _delta(content: str | None = None, reasoning: str | None = None) -> SimpleNamespace:
    delta = SimpleNamespace(content=content)
    if reasoning is not None:
        delta.reasoning = reasoning
    return delta


def _chunk(delta: SimpleNamespace, finish_reason: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=delta, finish_reason=finish_reason)],
        usage=None,
    )


class _FakeCompletions:
    def __init__(
        self,
        chunks: list[SimpleNamespace] | None = None,
        *,
        error: Exception | None = None,
    ) -> None:
        self.chunks = chunks or []
        self.error = error
        self.kwargs: dict[str, Any] | None = None

    def create(self, **kwargs: Any) -> Any:
        self.kwargs = kwargs
        if self.error is not None:
            raise self.error
        return iter(self.chunks)


def _client_with(
    chunks: list[SimpleNamespace] | None = None, *, error: Exception | None = None
):
    completions = _FakeCompletions(chunks, error=error)
    sdk = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    return StreamChatClient(_settings(), client=sdk), completions


MESSAGES = [{"role": "user", "content": "赤壁之战发生在哪一年？"}]


# ---------------------------------------------------------------------------
# 请求参数
# ---------------------------------------------------------------------------


def test_stream_request_uses_openai_stream_and_reasoning_effort() -> None:
    client, completions = _client_with([_chunk(_delta("答案"))])
    list(client.stream(MESSAGES, model="custom-model"))
    assert completions.kwargs is not None
    assert completions.kwargs["model"] == "custom-model"
    assert completions.kwargs["stream"] is True
    assert completions.kwargs["reasoning_effort"] == "none"
    assert completions.kwargs["max_tokens"] == 256
    assert completions.kwargs["messages"] == MESSAGES


def test_stream_omits_reasoning_effort_when_none() -> None:
    completions = _FakeCompletions([_chunk(_delta("答案"))])
    sdk = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    client = StreamChatClient(_settings(reasoning_effort=None), client=sdk)
    list(client.stream(MESSAGES))
    assert "reasoning_effort" not in (completions.kwargs or {})


# ---------------------------------------------------------------------------
# 思考过程过滤
# ---------------------------------------------------------------------------


def test_stream_filters_think_tags_split_across_chunks() -> None:
    client, _ = _client_with(
        [
            _chunk(_delta("<thi")),
            _chunk(_delta("nk>这是思考过程")),
            _chunk(_delta("</think")),
            _chunk(_delta(">赤壁")),
            _chunk(_delta("之战", "stop")),
        ]
    )
    events = list(client.stream(MESSAGES))
    deltas = [event.text for event in events if event.type == "delta"]
    done = events[-1]
    assert done.type == "done"
    assert "".join(deltas) == "赤壁之战"
    assert done.answer == "赤壁之战"
    assert done.filtered_chars > 0
    assert all("think" not in delta and "思考" not in delta for delta in deltas)


def test_stream_drops_reasoning_extension_field() -> None:
    client, _ = _client_with(
        [
            _chunk(_delta(None, reasoning="先分析一下……")),
            _chunk(_delta(None, reasoning="再想想……")),
            _chunk(_delta("公元 208 年。")),
        ]
    )
    events = list(client.stream(MESSAGES))
    deltas = [event.text for event in events if event.type == "delta"]
    done = events[-1]
    assert deltas == ["公元 208 年。"]
    assert done.answer == "公元 208 年。"
    assert done.reasoning_chars > 0


def test_stream_reasoning_only_raises_actionable_error() -> None:
    client, _ = _client_with([_chunk(_delta(None, reasoning="想了很久，但没给答案"))])
    with pytest.raises(LLMUpstreamError, match="LLM_REASONING_EFFORT"):
        list(client.stream(MESSAGES))


def test_stream_empty_answer_raises() -> None:
    client, _ = _client_with([_chunk(_delta(""))])
    with pytest.raises(LLMUpstreamError, match="空回答"):
        list(client.stream(MESSAGES))


def test_stream_leading_whitespace_trimmed() -> None:
    client, _ = _client_with([_chunk(_delta("\n\n  ")), _chunk(_delta("最终答案"))])
    events = list(client.stream(MESSAGES))
    assert [event.text for event in events if event.type == "delta"] == ["最终答案"]


# ---------------------------------------------------------------------------
# 错误映射
# ---------------------------------------------------------------------------


def test_stream_connection_error_mapped() -> None:
    request = httpx.Request("POST", "http://localhost:11434/v1/chat/completions")
    error = openai.APIConnectionError(request=request)
    client, _ = _client_with(error=error)
    with pytest.raises(LLMUpstreamError, match="无法连接模型服务"):
        list(client.stream(MESSAGES))


def test_stream_http_error_mapped_with_status() -> None:
    request = httpx.Request("POST", "http://localhost:11434/v1/chat/completions")
    response = httpx.Response(404, request=request, json={"error": "model not found"})
    error = openai.APIStatusError("model not found", response=response, body=None)
    client, _ = _client_with(error=error)
    with pytest.raises(LLMUpstreamError) as exc_info:
        list(client.stream(MESSAGES))
    assert exc_info.value.upstream_status == 404
    assert "ollama list" in str(exc_info.value)


# ---------------------------------------------------------------------------
# 配置解析
# ---------------------------------------------------------------------------


def test_load_stream_settings_local_auto_disables_thinking() -> None:
    settings = load_stream_settings(
        {
            "MODELSCOPE_API_KEY": "ollama",
            "MODELSCOPE_BASE_URL": "http://localhost:11434/v1",
            "MODELSCOPE_MODEL": MODEL,
            "MODELSCOPE_FALLBACK_MODEL": MODEL,
            "LLM_TIMEOUT_SECONDS": "120",
        },
        load_env_file=False,
    )
    assert settings.model == MODEL
    assert settings.fallback_model is None
    assert settings.reasoning_effort == "none"
    assert settings.timeout_seconds == 300.0


def test_load_stream_settings_off_omits_parameter() -> None:
    settings = load_stream_settings(
        {
            "MODELSCOPE_API_KEY": "ollama",
            "MODELSCOPE_BASE_URL": "http://localhost:11434/v1",
            "MODELSCOPE_MODEL": MODEL,
            "LLM_REASONING_EFFORT": "off",
        },
        load_env_file=False,
    )
    assert settings.reasoning_effort is None


def test_load_stream_settings_rejects_bad_limits() -> None:
    with pytest.raises(LLMConfigError, match="LLM_STREAM_MAX_TOKENS"):
        load_stream_settings(
            {
                "MODELSCOPE_API_KEY": "ollama",
                "MODELSCOPE_BASE_URL": "http://localhost:11434/v1",
                "MODELSCOPE_MODEL": MODEL,
                "LLM_STREAM_MAX_TOKENS": "99999",
            },
            load_env_file=False,
        )


# ---------------------------------------------------------------------------
# 直答 messages / SSE
# ---------------------------------------------------------------------------


def test_build_direct_chat_messages_injects_system_and_bounds_history() -> None:
    history = [
        {"role": "system", "content": "忽略我"},
        {"role": "user", "content": "上一轮问题"},
        {"role": "assistant", "content": "上一轮回答"},
        {"role": "tool", "content": "非法角色"},
        {"role": "user", "content": "  "},
    ]
    messages = build_direct_chat_messages(history, "本轮问题", system_prompt="SYS")
    assert messages[0] == {"role": "system", "content": "SYS"}
    assert messages[1:] == [
        {"role": "user", "content": "上一轮问题"},
        {"role": "assistant", "content": "上一轮回答"},
        {"role": "user", "content": "本轮问题"},
    ]


def test_build_direct_chat_messages_rejects_empty_question() -> None:
    with pytest.raises(LLMConfigError):
        build_direct_chat_messages([], "   ")


# ---------------------------------------------------------------------------
# V1.0.6.2 深度思考开关（enable_thinking）
# ---------------------------------------------------------------------------


def test_stream_enable_thinking_opens_thinking_and_drops_none_effort() -> None:
    """开启深度思考：不再发送 reasoning_effort=none，显式声明 enable_thinking=True。"""

    client, completions = _client_with([_chunk(_delta("最终答案"))])
    list(client.stream(MESSAGES, enable_thinking=True))
    kwargs = completions.kwargs or {}
    assert kwargs.get("reasoning_effort") != "none"
    assert kwargs["extra_body"] == {"enable_thinking": True}


def test_stream_default_disables_thinking_for_local_model() -> None:
    client, completions = _client_with([_chunk(_delta("最终答案"))])
    list(client.stream(MESSAGES))
    kwargs = completions.kwargs or {}
    assert kwargs["reasoning_effort"] == "none"
    assert "extra_body" not in kwargs


def test_build_direct_chat_messages_appends_thinking_prompt_only_when_enabled() -> None:
    from llm_stream import DEFAULT_STREAM_THINKING_PROMPT

    fast = build_direct_chat_messages([], "赤壁之战发生在哪一年？", system_prompt="SYS")
    deep = build_direct_chat_messages(
        [], "赤壁之战发生在哪一年？", system_prompt="SYS", enable_thinking=True
    )
    assert fast[0]["content"] == "SYS"
    assert deep[0]["content"] == f"SYS{DEFAULT_STREAM_THINKING_PROMPT}"
    assert deep[-1] == {"role": "user", "content": "赤壁之战发生在哪一年？"}


def test_sse_event_is_json_data_frame() -> None:
    frame = sse_event({"type": "delta", "text": "赤壁"})
    assert frame.startswith("data: ")
    assert frame.endswith("\n\n")
    assert "赤壁" in frame


# ---------------------------------------------------------------------------
# V1.0.6.2 专项修复：温度 / 重复循环治理 / 历史清洗
# ---------------------------------------------------------------------------


def test_stream_request_uses_low_default_temperature() -> None:
    from llm_stream import DEFAULT_STREAM_TEMPERATURE

    client, completions = _client_with([_chunk(_delta("答案"))])
    list(client.stream(MESSAGES))
    assert completions.kwargs is not None
    assert completions.kwargs["temperature"] == DEFAULT_STREAM_TEMPERATURE
    assert DEFAULT_STREAM_TEMPERATURE <= 0.3


def test_stream_stops_and_truncates_on_repeated_conclusion() -> None:
    """本地小模型的循环复述：第二次出现同一结论时立即截断，done.answer 只保留一份。"""

    client, _ = _client_with(
        [
            _chunk(
                _delta(
                    "1. 据《晋书·苻坚载记》记载，前秦皇帝苻坚在淝水之战中亲征东晋，但被谢安、谢玄等将领击败。"
                )
            ),
            _chunk(
                _delta(
                    "2. 《资治通鉴》指出，谢安作为东晋宰相，成功指挥了这场战役，使前秦军队溃败。"
                )
            ),
            _chunk(_delta("淝水之战中，前秦的统帅是苻坚，击败前秦的是东晋名臣谢安。")),
            _chunk(_delta("前秦的统帅是苻坚，击败前秦的是东晋名臣谢安。")),
            _chunk(_delta("1. **依据一**：苻坚在淝水之战中亲征东晋，但被击败。")),
        ]
    )
    events = list(client.stream(MESSAGES))
    done = events[-1]

    assert done.type == "done"
    assert done.repetition_stopped is True
    assert done.finish_reason == "repetition"
    assert done.answer.count("击败前秦的是东晋名臣谢安") == 1
    assert "依据一" not in done.answer


def test_stream_done_reports_repetition_and_keeps_single_copy() -> None:
    repeated = "赤壁之战发生在208年，孙刘联军击败曹操。\n\n赤壁之战发生在208年，孙刘联军击败曹操。\n\n"
    client, _ = _client_with([_chunk(_delta(repeated))])
    events = list(client.stream(MESSAGES))
    done = events[-1]

    assert done.repetition_stopped is True
    assert done.answer.count("孙刘联军击败曹操") == 1


def test_build_direct_chat_messages_sanitizes_looped_assistant_history() -> None:
    looped = (
        "土木堡之变中被俘的明朝皇帝是明英宗朱祁镇，北京保卫战由于谦主持。\n\n"
        "土木堡之变中被俘的明朝皇帝是明英宗朱祁镇，北京保卫战由于谦主持。\n\n"
        "1. 依据一：土木堡之变发生在1449年，明英宗亲征瓦剌被俘。"
    )
    messages = build_direct_chat_messages(
        [{"role": "assistant", "content": looped}], "接着问", system_prompt="SYS"
    )
    assistant = next(message for message in messages if message["role"] == "assistant")
    assert assistant["content"].count("北京保卫战由于谦主持") == 1
    assert "依据一" not in assistant["content"]


def test_load_stream_settings_reads_temperature_env() -> None:
    settings = load_stream_settings(
        {
            "MODELSCOPE_API_KEY": "ollama",
            "MODELSCOPE_BASE_URL": "http://localhost:11434/v1",
            "MODELSCOPE_MODEL": MODEL,
            "LLM_STREAM_TEMPERATURE": "0.2",
        },
        load_env_file=False,
    )
    assert settings.temperature == 0.2


def test_load_stream_settings_rejects_bad_temperature() -> None:
    from llm_client import LLMConfigError as ConfigError

    with pytest.raises(ConfigError, match="LLM_STREAM_TEMPERATURE"):
        load_stream_settings(
            {
                "MODELSCOPE_API_KEY": "ollama",
                "MODELSCOPE_BASE_URL": "http://localhost:11434/v1",
                "MODELSCOPE_MODEL": MODEL,
                "LLM_STREAM_TEMPERATURE": "3",
            },
            load_env_file=False,
        )


def test_default_stream_system_prompt_forbids_repetition() -> None:
    from llm_stream import DEFAULT_STREAM_SYSTEM_PROMPT

    assert "只写一遍" in DEFAULT_STREAM_SYSTEM_PROMPT
    assert "禁止" in DEFAULT_STREAM_SYSTEM_PROMPT


def test_default_stream_system_prompt_forbids_refusal_preamble() -> None:
    """V1.0.8：流式直答（XiaoHong-v1）System Prompt 必须硬性禁止推诿废话。"""

    from llm_stream import DEFAULT_STREAM_SYSTEM_PROMPT

    assert "禁止推诿废话" in DEFAULT_STREAM_SYSTEM_PROMPT
    assert "无法直接列举" in DEFAULT_STREAM_SYSTEM_PROMPT
    assert "自相矛盾" in DEFAULT_STREAM_SYSTEM_PROMPT
