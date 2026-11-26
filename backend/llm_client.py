"""LLM Client（V1.0.1 / TC-10 连通性探测；V1.0.5 高可用降级补丁；V1.0.5.2 请求级模型选择）。

职责：
- 从环境变量 / `backend/.env` 读取 ModelScope（OpenAI 兼容）推理服务的 key、base URL、
  主模型名与备用模型名（`MODELSCOPE_FALLBACK_MODEL`）；
- 提供模型注册表（`list_model_options()`）供 `GET /api/agent/models` 与前端切换窗口使用；
- 提供一个最小的同步 `ping()`：发送一句测试话（默认「请回复 OK」），返回模型真实回复与耗时；
- 提供 Agent 循环使用的 `chat()`：支持**请求级手动选择模型**（`model_id`）；
  不论手动选择哪一款，另一款都会作为自动降级目标——遇到 429 / 502 / 504 / 超时自动切换重试一次，
  并在结果里用 `model_used` 标明最终完成回答的模型；
- 统一把配置错误 / 超时 / 上游 HTTP 错误映射成可被 `errors.ApiError` 消费的异常。

安全约定：
- **密钥只经环境变量 / `.env` 传入**，不写日志、不入库、不出现在响应里；
- 响应只返回模型名、回复、耗时与 token 用量；base URL 仅用于构造请求；
- 上游错误信息会截断并做一次 key 脱敏，避免反向代理回显请求头；
- **禁止自动跟随重定向**（P1-5）：任何 3xx 都按上游错误处理，防止 Authorization 头被带到
  非预期主机。

本模块不依赖 FastAPI，可被 `backend/scripts/spike_llm.py` 单独调用。
应用入口是 `routers/agent.py` 的 `GET /api/agent/ping_llm` 与 `GET /api/agent/models`。
"""

from __future__ import annotations

import logging
import os
import re
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from think_filter import strip_think_tags

logger = logging.getLogger("histolink.llm")

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent

#: ModelScope 推理服务默认地址（OpenAI 兼容，实际请求 <base>/chat/completions）。
DEFAULT_BASE_URL = "https://api-inference.modelscope.cn/v1"
#: 默认主模型（TC-10 实测可用：Qwen/Qwen3.5-35B-A3B；V1.0.5.2 正式主模型）。
DEFAULT_MODEL = "Qwen/Qwen3.5-35B-A3B"
#: 默认备用降级模型（V1.0.5 高可用补丁；V1.0.5.2 正式备用模型）。
DEFAULT_FALLBACK_MODEL = "Qwen/Qwen3.5-8B-Instruct"
#: 模型角色（对外注册表 / 前端切换窗口使用）。
MODEL_ROLE_PRIMARY = "primary"
MODEL_ROLE_FALLBACK = "fallback"
#: 模型注册表的静态说明（模型名可在 .env 覆盖，说明按默认名给出；未知模型给通用说明）。
_MODEL_DESCRIPTIONS: dict[str, str] = {
    DEFAULT_MODEL: "主模型：推理能力更强，默认用于回答所有历史问题。",
    DEFAULT_FALLBACK_MODEL: "备用降级模型：更轻量、额度更宽松；主模型限流 / 超时 / 失败时自动接管。",
}
#: 触发「切换另一款模型重试」的上游 HTTP 状态码：429 限流、502/504 网关错误。
#: 其余 4xx（鉴权 / 参数错误）与 500/503 不降级：换模型也不会好，直接按原错误抛给 API 层。
FALLBACK_UPSTREAM_STATUSES = frozenset({429, 502, 504})
#: 仅在「前端手动选择模型」时额外承认的降级状态码（V1.0.5.2）：
#: 400 / 404 通常表示该模型名在当前账号不可用，切回另一款模型即可恢复；
#: 默认主模型路径不使用这两个状态码降级，避免掩盖请求参数错误。
MANUAL_SELECTION_FALLBACK_STATUSES = frozenset({400, 404})
DEFAULT_TIMEOUT_SECONDS = 30.0
DEFAULT_PING_MESSAGE = "请回复 OK"
MAX_REPLY_LENGTH = 2000
MAX_ERROR_EXCERPT = 200
#: Agent 对话（chat）参数上限。
MAX_CHAT_MESSAGES = 40
#: 单条消息字符上限（V1.0.6.1 上调 20000 → 32000）。
#: V1.0.6.1 的 System Prompt 包含「双重事实核查 + 输出规范 + 完整 Few-Shot 优秀回答示例」
#: 与工具目录，实测约 23.3k 字；旧上限 20000 会让每次问答都抛 LLMConfigError（503）。
#: 单条消息仍然有界，避免异常构造的超长消息直接打到上游。
MAX_CHAT_MESSAGE_CHARS = 32000
MAX_CHAT_TOKENS = 8192
MAX_CHAT_CONTENT_CHARS = 40000

#: 环境变量别名（按顺序取第一个非空值）；主推 MODELSCOPE_*，兼容常见 LLM_* / OPENAI_*。
_API_KEY_ENV_NAMES = (
    "MODELSCOPE_API_KEY",
    "MODELSCOPE_KEY",
    "LLM_API_KEY",
    "OPENAI_API_KEY",
)
_BASE_URL_ENV_NAMES = (
    "MODELSCOPE_BASE_URL",
    "MODELSCOPE_URL",
    "LLM_BASE_URL",
    "OPENAI_BASE_URL",
)
_MODEL_ENV_NAMES = ("MODELSCOPE_MODEL", "LLM_MODEL", "OPENAI_MODEL")
_FALLBACK_MODEL_ENV_NAMES = ("MODELSCOPE_FALLBACK_MODEL", "LLM_FALLBACK_MODEL")
#: V1.0.6.2 修复：前端模型切换窗口的展示名（id 仍是真实模型名，用于请求上游）。
#: 例如本地 Ollama 模型 `hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M` 展示为 `XiaoHong-v1`。
_MODEL_DISPLAY_ENV_NAMES = ("LLM_MODEL_DISPLAY_NAME", "MODELSCOPE_MODEL_DISPLAY_NAME")
_FALLBACK_MODEL_DISPLAY_ENV_NAMES = (
    "LLM_FALLBACK_MODEL_DISPLAY_NAME",
    "MODELSCOPE_FALLBACK_MODEL_DISPLAY_NAME",
)
_TIMEOUT_ENV_NAMES = ("LLM_TIMEOUT_SECONDS", "MODELSCOPE_TIMEOUT_SECONDS")
#: V1.0.6.2：思考开关（none / auto / low / medium / high / off）。
#: 本地 Ollama 的 Qwen3 模板默认开启思考，XiaoHong-v1 不会输出  收尾标签，
#: 开启思考时 OpenAI 兼容层会把全部内容放进 reasoning、content 为空，因此 auto 模式
#: 对「本机回环地址」自动按 none 处理（见 `resolve_reasoning_effort`）。
_REASONING_EFFORT_ENV_NAMES = ("LLM_REASONING_EFFORT",)
#: 显式「不发送 reasoning_effort 参数」的取值（关闭思考请用 ``none``）。
_OMIT_REASONING_EFFORT_VALUES = frozenset({"off", "false", "no", "omit", "disabled"})
#: 本机回环主机名：auto 模式下本地推理默认关闭思考。
_LOCAL_BASE_URL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0"})


class LLMConfigError(RuntimeError):
    """配置缺失或非法；映射为 503 `LLM_NOT_CONFIGURED`。"""


class LLMTimeoutError(RuntimeError):
    """调用超时；映射为 504 `LLM_TIMEOUT`。"""


class LLMUpstreamError(RuntimeError):
    """上游返回错误（鉴权、限流、5xx、响应格式异常等）；映射为 502 `LLM_UPSTREAM_ERROR`。"""

    def __init__(
        self,
        message: str,
        *,
        upstream_status: int | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.upstream_status = upstream_status
        self.retryable = retryable


@dataclass(frozen=True)
class LLMSettings:
    """一次调用所需的配置（不可变，避免请求间串改）。

    `fallback_model` 为 V1.0.5 高可用补丁新增：主模型失败时自动切换的备用（轻量）模型；
    为 `None` 表示不降级（例如主备配置成同一个模型名，重试没有意义）。
    """

    api_key: str
    base_url: str
    model: str
    timeout_seconds: float
    fallback_model: str | None = None
    #: V1.0.6.2：思考开关。``None`` 表示请求体不带该参数；``"none"`` 让 Ollama 关闭思考
    #: （最终答案写进 content，流式才有内容）；也可为 low / medium / high。
    reasoning_effort: str | None = None

    @property
    def chat_completions_url(self) -> str:
        base = self.base_url.rstrip("/")
        # 允许直接填完整 endpoint（某些网关这样给出），否则补 OpenAI 兼容路径。
        if base.endswith("/chat/completions"):
            return base
        return f"{base}/chat/completions"

    @property
    def masked_key(self) -> str:
        """日志 / 调试用：只保留首尾各 2 位。"""

        key = self.api_key
        if len(key) <= 6:
            return "***"
        return f"{key[:2]}***{key[-2:]}"


@dataclass(frozen=True)
class LLMPingResult:
    reply: str
    model: str
    latency_ms: int
    usage: dict[str, int] | None = None


@dataclass(frozen=True)
class LLMChatResult:
    """一次 chat completion 的原始回复（V1.0.3 Agent 循环使用）。

    - `model`：沿用上游响应里的 `model` 字段（没有则回填实际请求的模型名）；
    - `model_used`：V1.0.5 高可用补丁新增，**实际发起并通过请求的模型名**（主模型或备用模型），
      用于 `trace.model_used` 与前端「已切换轻量模型」提示。
    """

    content: str
    model: str
    latency_ms: int
    usage: dict[str, int] | None = None
    model_used: str | None = None


_dotenv_loaded = False


@dataclass(frozen=True)
class ModelOption:
    """模型注册表条目（V1.0.5.2）：`GET /api/agent/models` 与前端模型切换窗口的数据源。

    - ``id``：请求里回传的 `model_id`（与上游模型名逐字一致）；
    - ``name``：前端展示的模型全称（当前与模型名相同）；
    - ``role``：``primary``（默认主模型）/ ``fallback``（备用降级模型）；
    - ``description``：一句话说明，用于下拉项副标题。
    """

    id: str
    name: str
    role: str
    description: str | None = None

    def to_dict(self) -> dict[str, str]:
        payload = {"id": self.id, "name": self.name, "role": self.role}
        if self.description:
            payload["description"] = self.description
        return payload


def _load_env_files() -> None:
    """加载 `backend/.env` 与仓库根 `.env`（不覆盖进程已有环境变量）。"""

    global _dotenv_loaded
    if _dotenv_loaded:
        return
    _dotenv_loaded = True

    try:
        from dotenv import load_dotenv
    except ImportError:  # pragma: no cover - 依赖缺失时退回纯环境变量
        return

    for candidate in (BACKEND_DIR / ".env", PROJECT_ROOT / ".env"):
        if candidate.is_file():
            load_dotenv(candidate, override=False, encoding="utf-8")


def _first_non_empty(source: Mapping[str, str], names: tuple[str, ...]) -> str | None:
    for name in names:
        value = source.get(name)
        if value is None:
            continue
        cleaned = value.strip()
        if cleaned:
            return cleaned
    return None


def is_local_base_url(base_url: str) -> bool:
    """``base_url`` 是否指向本机回环地址（auto 模式据此决定是否关闭思考）。"""

    try:
        host = (urlsplit(base_url).hostname or "").strip().lower()
    except ValueError:
        return False
    return host in _LOCAL_BASE_URL_HOSTS


def resolve_reasoning_effort(raw: str | None, base_url: str) -> str | None:
    """解析 ``LLM_REASONING_EFFORT``（V1.0.6.2）。

    - 未配置 → ``auto``：本机回环地址返回 ``"none"``（关闭思考），云端返回 ``None``
      （不发送参数，保持 ModelScope 等云端行为不变）；
    - ``none`` → 原样返回（Ollama 关闭思考，最终答案进 content）；
    - ``off`` / ``omit`` 等 → ``None``（请求体不带该参数，交给上游默认行为）；
    - 其它（low / medium / high）→ 原样透传。
    """

    if raw is None:
        raw = "auto"
    lowered = raw.strip().lower()
    if lowered in _OMIT_REASONING_EFFORT_VALUES:
        return None
    if lowered == "auto":
        return "none" if is_local_base_url(base_url) else None
    return lowered


def _model_names(source: Mapping[str, str]) -> tuple[str, str]:
    """读取主模型 / 备用模型名（只做名称解析，不校验 key，供注册表与配置共用）。"""

    primary = _first_non_empty(source, _MODEL_ENV_NAMES) or DEFAULT_MODEL
    fallback = (
        _first_non_empty(source, _FALLBACK_MODEL_ENV_NAMES) or DEFAULT_FALLBACK_MODEL
    )
    return primary, fallback


def model_display_name(model: str) -> str:
    """模型在前端切换窗口里的展示名（V1.0.6.2 修复）。

    请求上游用的 `id` 必须保持真实模型名（`hf.co/...:Q4_K_M`），但给用户看的名字应该短而
    易懂。规则：
    - 只对 HuggingFace GGUF 风格模型名做自动缩写：取最后一段、去 `-GGUF`、去 `:量化后缀`；
      例如 `hf.co/mradermacher/XiaoHong-v1-GGUF:Q4_K_M` → `XiaoHong-v1`；
    - 其它模型名（如 `Qwen/Qwen3.5-35B-A3B`）原样返回，避免误伤云端模型命名；
    - 需要完全自定义时用环境变量 `LLM_MODEL_DISPLAY_NAME` / `LLM_FALLBACK_MODEL_DISPLAY_NAME`。
    """

    name = (model or "").strip()
    if not name:
        return name
    if "gguf" not in name.lower():
        return name
    tail = name.rsplit("/", 1)[-1]
    base, separator, _quant = tail.partition(":")
    if separator and not base:
        base = tail
    base = re.sub(r"[-_. ]?GGUF$", "", base, flags=re.IGNORECASE)
    return base or name


def _model_labels(source: Mapping[str, str]) -> tuple[str, str]:
    """读取主模型 / 备用模型的前端展示名（优先环境变量，其次自动缩写）。"""

    primary, fallback = _model_names(source)
    primary_label = _first_non_empty(
        source, _MODEL_DISPLAY_ENV_NAMES
    ) or model_display_name(primary)
    fallback_label = _first_non_empty(
        source, _FALLBACK_MODEL_DISPLAY_ENV_NAMES
    ) or model_display_name(fallback)
    return primary_label, fallback_label


def list_model_options(
    env: Mapping[str, str] | None = None,
    *,
    load_env_file: bool = True,
) -> list[ModelOption]:
    """模型注册表（V1.0.5.2）：始终返回 1 款主模型，主备不同名时再追加备用模型。

    该函数**不要求配置 API key**，因此前端启动时即可渲染模型切换窗口；
    实际调用模型仍由 `chat()` 在缺少 key 时抛 `LLMConfigError`（映射为 503）。

    V1.0.6.2：`id` 仍是真实模型名（用于请求上游），`name` 改为前端展示名
    （如 `hf.co/.../XiaoHong-v1-GGUF:Q4_K_M` → `XiaoHong-v1`）。
    """

    if load_env_file:
        _load_env_files()
    source: Mapping[str, str] = os.environ if env is None else env
    primary, fallback = _model_names(source)
    primary_label, fallback_label = _model_labels(source)
    options = [
        ModelOption(
            id=primary,
            name=primary_label,
            role=MODEL_ROLE_PRIMARY,
            description=_MODEL_DESCRIPTIONS.get(
                primary, "主模型：默认用于回答所有历史问题。"
            ),
        )
    ]
    if fallback != primary:
        options.append(
            ModelOption(
                id=fallback,
                name=fallback_label,
                role=MODEL_ROLE_FALLBACK,
                description=_MODEL_DESCRIPTIONS.get(
                    fallback,
                    "备用降级模型：所选模型限流 / 超时 / 失败时自动接管。",
                ),
            )
        )
    return options


def resolve_model_pair(
    settings: LLMSettings, model_id: str | None = None
) -> tuple[str, str | None]:
    """解析请求级模型选择：返回 ``(所选模型, 另一款用于自动降级的模型)``。

    - ``model_id`` 为空 → 默认主模型，备用模型作为降级目标；
    - 选中主模型 → 备用模型降级；
    - 选中备用模型 → 主模型降级（双向降级，满足「手动选择后降级规则仍生效」）；
    - 未知 ``model_id`` → `LLMConfigError`（API 层映射为 400 / 503 前先做白名单校验）。
    """

    primary = settings.model
    fallback = settings.fallback_model
    if not model_id:
        return primary, fallback
    if model_id == primary:
        return primary, fallback
    if fallback is not None and model_id == fallback:
        return fallback, primary
    raise LLMConfigError(
        f"未知模型：{model_id}（可选：{primary}"
        + (f"、{fallback}" if fallback and fallback != primary else "")
        + "）"
    )


def load_llm_settings(
    env: Mapping[str, str] | None = None,
    *,
    load_env_file: bool = True,
) -> LLMSettings:
    """读取并校验 LLM 配置；缺失时抛出带修复提示的 `LLMConfigError`。"""

    if load_env_file:
        _load_env_files()
    source: Mapping[str, str] = os.environ if env is None else env

    api_key = _first_non_empty(source, _API_KEY_ENV_NAMES)
    if api_key is None:
        raise LLMConfigError(
            "未配置模型密钥：请在 backend/.env 写入 MODELSCOPE_API_KEY（或设置同名环境变量）后重启服务。"
            " 可参考 backend/.env.example。"
        )

    base_url = _first_non_empty(source, _BASE_URL_ENV_NAMES) or DEFAULT_BASE_URL
    if not base_url.startswith(("http://", "https://")):
        raise LLMConfigError(
            f"MODELSCOPE_BASE_URL 必须以 http(s):// 开头，当前值不合法：{base_url!r}"
        )

    model, fallback_name = _model_names(source)

    # V1.0.5 高可用补丁：备用模型默认 Qwen/Qwen3.5-8B-Instruct（轻量、额度更宽松）；
    # V1.0.5.2：主备共同构成模型注册表，手动选择任意一款时另一款作为自动降级目标。
    fallback_model: str | None = fallback_name
    if fallback_model == model:
        # 主备同名：没有可切换的模型，禁用降级，避免对同一个已限流模型重复请求。
        fallback_model = None

    raw_timeout = _first_non_empty(source, _TIMEOUT_ENV_NAMES) or str(
        DEFAULT_TIMEOUT_SECONDS
    )
    try:
        timeout_seconds = float(raw_timeout)
    except ValueError as exc:
        raise LLMConfigError(
            f"LLM_TIMEOUT_SECONDS 必须是数字，当前值：{raw_timeout!r}"
        ) from exc
    if not 1.0 <= timeout_seconds <= 300.0:
        raise LLMConfigError(
            f"LLM_TIMEOUT_SECONDS 必须在 1–300 秒之间，当前值：{timeout_seconds}"
        )

    # V1.0.6.2：思考开关（本地 Ollama 默认关闭思考，否则 content 可能为空）。
    reasoning_effort = resolve_reasoning_effort(
        _first_non_empty(source, _REASONING_EFFORT_ENV_NAMES), base_url
    )

    return LLMSettings(
        api_key=api_key,
        base_url=base_url,
        model=model,
        timeout_seconds=timeout_seconds,
        fallback_model=fallback_model,
        reasoning_effort=reasoning_effort,
    )


def _safe_excerpt(text: str, *, secret: str) -> str:
    """截断上游错误文本并脱敏，避免把 key 回显到响应/日志。"""

    compact = " ".join((text or "").split())
    if secret:
        compact = compact.replace(secret, "***")
    return compact[:MAX_ERROR_EXCERPT]


def _parse_usage(payload: Any) -> dict[str, int] | None:
    if not isinstance(payload, dict):
        return None
    usage: dict[str, int] = {}
    for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
        value = payload.get(key)
        if isinstance(value, int) and value >= 0:
            usage[key] = value
    return usage or None


class LLMClient:
    """最小 OpenAI 兼容客户端；`transport` 仅用于测试（httpx.MockTransport）。"""

    def __init__(
        self,
        settings: LLMSettings,
        *,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._settings = settings
        self._transport = transport

    @classmethod
    def from_env(cls) -> LLMClient:
        return cls(load_llm_settings())

    @property
    def settings(self) -> LLMSettings:
        return self._settings

    def ping(self, message: str = DEFAULT_PING_MESSAGE) -> LLMPingResult:
        """发送测试语句并返回模型回复；网络/上游错误统一转成 LLM* 异常。"""

        text = message.strip()
        if not text:
            raise LLMConfigError("测试语句不能为空")
        if len(text) > 200:
            raise LLMConfigError("测试语句长度不能超过 200 字")

        settings = self._settings
        payload: dict[str, Any] = {
            "model": settings.model,
            "messages": [{"role": "user", "content": text}],
            "temperature": 0.0,
            "max_tokens": 64,
            "stream": False,
        }
        # V1.0.6.2：本地 Ollama 需要显式关闭思考，否则 content 可能为空、答案跑到 reasoning。
        if settings.reasoning_effort is not None:
            payload["reasoning_effort"] = settings.reasoning_effort
        data, latency_ms = self._post_chat(payload)
        reply = _extract_content(data).strip()
        if len(reply) > MAX_REPLY_LENGTH:
            reply = reply[:MAX_REPLY_LENGTH] + "…"
        return LLMPingResult(
            reply=reply,
            model=_extract_model(data, settings.model),
            latency_ms=latency_ms,
            usage=_parse_usage(data.get("usage")),
        )

    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.0,
        max_tokens: int = 2048,
        response_format: dict[str, Any] | None = None,
        enable_thinking: bool = False,
        timeout_seconds: float | None = None,
        model_id: str | None = None,
    ) -> LLMChatResult:
        """OpenAI 兼容 chat completion（V1.0.3 Agent 使用；V1.0.5 / V1.0.5.2 高可用降级）。

        - 默认 **`enable_thinking=False`**：spike 实测思考模式会消耗大量 reasoning tokens
          且 `max_tokens` 不约束它们，必须显式关闭以追求极速响应；
        - `response_format={"type":"json_object"}` 由 Orchestrator 按需传入；
        - **请求级模型选择（V1.0.5.2）**：`model_id` 为模型注册表里的 id；为空时使用主模型。
          手动选择备用模型时，主模型会成为自动降级目标（双向降级）；
        - **自动降级**：所选模型遇到 HTTP 429 / 502 / 504 或超时（含连接超时）时记录 warning，
          并自动用另一款模型重试**一次**；另一款仍失败则抛出带「已降级重试」上下文的
          `LLM_TIMEOUT` / `LLM_UPSTREAM_ERROR`；
        - 其它错误（401、400、302、500/503 等）不降级：换模型也不会修好，按原错误上抛；
        - 超时 / 上游错误沿用与 `ping()` 相同的异常映射；
        - 结果里的 `model_used` 标明最终完成本次回答的模型（所选项或降级后的另一款）。
        """

        normalized = _normalize_messages(messages)
        if not 0.0 <= temperature <= 2.0:
            raise LLMConfigError("temperature 必须在 0–2 之间")
        if not 1 <= max_tokens <= MAX_CHAT_TOKENS:
            raise LLMConfigError(f"max_tokens 必须在 1–{MAX_CHAT_TOKENS} 之间")
        if not isinstance(enable_thinking, bool):
            raise LLMConfigError("enable_thinking 必须是布尔值")
        if response_format is not None and (
            not isinstance(response_format, dict)
            or response_format.get("type") != "json_object"
        ):
            raise LLMConfigError('response_format 目前只支持 {"type": "json_object"}')
        if timeout_seconds is not None and not 1.0 <= timeout_seconds <= 300.0:
            raise LLMConfigError("timeout_seconds 必须在 1–300 秒之间")

        settings = self._settings
        requested, fallback = resolve_model_pair(settings, model_id)
        payload: dict[str, Any] = {
            "model": requested,
            "messages": normalized,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
            # spike 结论：顶层 enable_thinking 才生效；不要放进 extra_body。
            "enable_thinking": enable_thinking,
        }
        # V1.0.6.2：reasoning_effort 与 enable_thinking 是两套上游方言：
        # ModelScope 用 enable_thinking，Ollama 用 reasoning_effort=none 关闭思考。
        if settings.reasoning_effort is not None:
            payload["reasoning_effort"] = settings.reasoning_effort
        if response_format is not None:
            payload["response_format"] = response_format

        data, latency_ms, model_used = self._post_chat_with_fallback(
            payload,
            timeout_seconds=timeout_seconds,
            requested_model=requested,
            fallback_model=fallback,
            manual_selection=model_id is not None,
        )
        content = _extract_content(data)
        if len(content) > MAX_CHAT_CONTENT_CHARS:
            content = content[:MAX_CHAT_CONTENT_CHARS] + "…"
        return LLMChatResult(
            content=content,
            model=_extract_model(data, model_used),
            latency_ms=latency_ms,
            usage=_parse_usage(data.get("usage")),
            model_used=model_used,
        )

    def _post_chat_with_fallback(
        self,
        payload: dict[str, Any],
        *,
        timeout_seconds: float | None = None,
        requested_model: str | None = None,
        fallback_model: str | None = None,
        manual_selection: bool = False,
    ) -> tuple[dict[str, Any], int, str]:
        """所请求模型优先；命中降级条件时切另一款模型重试一次。返回 (data, latency_ms, model_used)。

        `manual_selection=True`（前端模型切换窗口手动选择）时，若所选模型在上游返回
        「模型不存在 / 参数非法」（400/404，例如该账号未开通该模型），也自动降级到另一款模型，
        满足「手动选择的模型异常时仍自动切换」的产品要求；默认主模型路径不放开这两类错误码。
        """

        settings = self._settings
        primary = requested_model or settings.model
        fallback = (
            fallback_model if requested_model is not None else settings.fallback_model
        )
        try:
            data, latency_ms = self._post_chat(payload, timeout_seconds=timeout_seconds)
            return data, latency_ms, primary
        except (LLMTimeoutError, LLMUpstreamError) as exc:
            if (
                fallback is None
                or fallback == primary
                or not _should_fallback(exc, manual_selection=manual_selection)
            ):
                raise
            # 注意：except 块结束后 `exc` 会被删除，先把脱敏摘要存下来。
            primary_error_text = _safe_excerpt(str(exc), secret=settings.api_key)

        logger.warning(
            "所选模型 %s 调用失败（%s），自动降级到另一款模型 %s 重试一次",
            primary,
            primary_error_text,
            fallback,
        )
        fallback_payload = {**payload, "model": fallback}
        try:
            data, latency_ms = self._post_chat(
                fallback_payload, timeout_seconds=timeout_seconds
            )
        except (LLMTimeoutError, LLMUpstreamError) as fallback_exc:
            logger.warning(
                "降级模型 %s 重试仍失败（%s）",
                fallback,
                _safe_excerpt(str(fallback_exc), secret=settings.api_key),
            )
            raise _decorate_fallback_error(
                fallback_exc, primary=primary, fallback=fallback
            ) from fallback_exc
        logger.info("降级模型 %s 已接管本次回答（所选模型 %s 降级）", fallback, primary)
        return data, latency_ms, fallback

    # ------------------------------------------------------------------
    # HTTP 公共路径
    # ------------------------------------------------------------------
    def _post_chat(
        self, payload: dict[str, Any], *, timeout_seconds: float | None = None
    ) -> tuple[dict[str, Any], int]:
        settings = self._settings
        timeout = (
            timeout_seconds if timeout_seconds is not None else settings.timeout_seconds
        )
        headers = {
            "Authorization": f"Bearer {settings.api_key}",
            "Content-Type": "application/json",
        }

        started = time.perf_counter()
        try:
            with httpx.Client(
                timeout=httpx.Timeout(timeout),
                transport=self._transport,
                # P1-5：禁止自动跟随重定向。模型服务被错误配置 / 劫持时，
                # 跟随 3xx 会把 Authorization 头带到攻击者指定的地址。
                follow_redirects=False,
            ) as client:
                response = client.post(
                    settings.chat_completions_url, headers=headers, json=payload
                )
        except httpx.TimeoutException as exc:
            raise LLMTimeoutError(
                f"模型服务超时（>{timeout:.0f}s），可调大 LLM_TIMEOUT_SECONDS 后重试。"
            ) from exc
        except httpx.HTTPError as exc:
            raise LLMUpstreamError(
                f"无法连接模型服务：{type(exc).__name__}（{_safe_excerpt(str(exc), secret=settings.api_key)}）",
                retryable=True,
            ) from exc
        latency_ms = int((time.perf_counter() - started) * 1000)

        if 300 <= response.status_code < 400:
            raise LLMUpstreamError(
                "模型服务返回重定向 HTTP "
                f"{response.status_code}（出于安全已禁用自动跟随，请检查 MODELSCOPE_BASE_URL）",
                upstream_status=response.status_code,
                retryable=False,
            )
        if response.status_code >= 400:
            retryable = response.status_code == 429 or response.status_code >= 500
            excerpt = _safe_excerpt(response.text, secret=settings.api_key)
            raise LLMUpstreamError(
                f"上游返回 HTTP {response.status_code}：{excerpt or '（无响应体）'}",
                upstream_status=response.status_code,
                retryable=retryable,
            )

        try:
            data = response.json()
        except ValueError as exc:
            raise LLMUpstreamError("上游返回的不是合法 JSON", retryable=False) from exc
        if not isinstance(data, dict):
            raise LLMUpstreamError(
                "上游返回 JSON 结构异常（期望对象）", retryable=False
            )
        return data, latency_ms


def _should_fallback(
    exc: LLMTimeoutError | LLMUpstreamError, *, manual_selection: bool = False
) -> bool:
    """判断异常是否属于「换另一款模型可能成功」的故障。

    - 超时 / 429 / 502 / 504：默认即降级；
    - 手动选择模型时额外承认 400 / 404：「模型不存在 / 该账号未开通」属于所选模型不可用，
      自动切回另一款模型即可恢复（默认主模型路径保持严格，不把参数错误当成降级理由）。
    """

    if isinstance(exc, LLMTimeoutError):
        return True
    if exc.upstream_status in FALLBACK_UPSTREAM_STATUSES:
        return True
    return (
        manual_selection and exc.upstream_status in MANUAL_SELECTION_FALLBACK_STATUSES
    )


def _decorate_fallback_error(
    exc: LLMTimeoutError | LLMUpstreamError, *, primary: str, fallback: str
) -> LLMTimeoutError | LLMUpstreamError:
    """给「备用模型也失败」的异常补上降级上下文，便于 API 层 / 日志定位。"""

    message = f"{exc}（所选模型 {primary} 失败后已自动降级到 {fallback} 重试，仍失败）"
    if isinstance(exc, LLMTimeoutError):
        return LLMTimeoutError(message)
    return LLMUpstreamError(
        message, upstream_status=exc.upstream_status, retryable=exc.retryable
    )


def _extract_content(data: Mapping[str, Any]) -> str:
    choices = data.get("choices")
    content: Any = None
    if isinstance(choices, list) and choices:
        first_choice = choices[0]
        if isinstance(first_choice, dict):
            message_payload = first_choice.get("message")
            if isinstance(message_payload, dict):
                content = message_payload.get("content")
    if not isinstance(content, str) or not content.strip():
        raise LLMUpstreamError(
            "上游返回缺少 choices[0].message.content", retryable=False
        )
    # V1.0.6.2：非流式兜底清洗 思考标签（部分 OpenAI 兼容层会把思考写进 content）。
    cleaned = strip_think_tags(content)
    if not cleaned:
        raise LLMUpstreamError("上游返回只有思考过程、没有最终答案", retryable=False)
    return cleaned


def _extract_model(data: Mapping[str, Any], fallback: str) -> str:
    model = data.get("model")
    return str(model) if isinstance(model, str) and model else fallback


def _normalize_messages(messages: Any) -> list[dict[str, str]]:
    if not isinstance(messages, (list, tuple)) or not messages:
        raise LLMConfigError("messages 不能为空")
    if len(messages) > MAX_CHAT_MESSAGES:
        raise LLMConfigError(f"messages 最多 {MAX_CHAT_MESSAGES} 条")
    normalized: list[dict[str, str]] = []
    for index, message in enumerate(messages):
        if not isinstance(message, Mapping):
            raise LLMConfigError(f"messages[{index}] 必须是对象")
        role = message.get("role")
        content = message.get("content")
        if role not in {"system", "user", "assistant"}:
            raise LLMConfigError(f"messages[{index}].role 必须是 system/user/assistant")
        if not isinstance(content, str) or not content.strip():
            raise LLMConfigError(f"messages[{index}].content 不能为空")
        if len(content) > MAX_CHAT_MESSAGE_CHARS:
            raise LLMConfigError(
                f"messages[{index}].content 超过 {MAX_CHAT_MESSAGE_CHARS} 字"
            )
        normalized.append({"role": role, "content": content})
    return normalized
