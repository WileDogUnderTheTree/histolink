"""工具注册表（V1.0.3）：白名单 + 严格 Pydantic 参数校验。

安全边界：
- 模型只能调用 `TOOL_NAMES` 白名单里的工具，未知工具直接拒绝；
- 模型给出的 `arguments` 先经过**严格 Pydantic 模型**（`extra="forbid"`、`strict=True`）校验，
  再以关键字参数调用工具函数，**不把模型原始 dict 直接展开传给 Python**；
- 校验失败返回统一失败信封（`INVALID_REQUEST`），由 Orchestrator 回传给模型修正。

Prompt 中的工具目录也由本模块生成，保证“给模型看的参数 schema”与“真正校验用的模型”同源。
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from agent.tools import TOOL_NAMES, Toolkit
from agent.tools.base import failure
from contracts.models import ErrorCode
from contracts.tools import TOOLS as CONTRACT_TOOLS

logger = logging.getLogger("histolink.tool_registry")


class StrictArguments(BaseModel):
    """工具参数基类：严格类型、禁止额外字段。"""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, strict=True)


PERSON_ID_PATTERN = r"^p-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{4}$"
EVENT_ID_PATTERN = r"^[a-z0-9][a-z0-9-]*$"
DEFAULT_LIMIT = 20


class YearRange(StrictArguments):
    start: int
    end: int

    @model_validator(mode="after")
    def validate_range(self) -> YearRange:
        if self.start == 0 or self.end == 0:
            raise ValueError("史书纪年不允许 0 年")
        if self.start > self.end:
            raise ValueError("year_range.start 不能晚于 year_range.end")
        return self


class ResolveEntityArgs(StrictArguments):
    query: str = Field(min_length=1, max_length=100)
    era_id: str | None = Field(default=None, max_length=64)


class SearchEventsArgs(StrictArguments):
    q: str = Field(min_length=1, max_length=200)
    dynasty: str | None = Field(default=None, max_length=50)
    year_range: YearRange | None = None
    importance_min: int | None = Field(default=None, ge=1, le=3)
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=80)


class GetEventArgs(StrictArguments):
    event_id: str = Field(pattern=EVENT_ID_PATTERN, min_length=1, max_length=128)


class GetPersonArgs(StrictArguments):
    person_id: str = Field(pattern=PERSON_ID_PATTERN, min_length=1, max_length=128)


class GetPersonEventsArgs(StrictArguments):
    person_id: str = Field(pattern=PERSON_ID_PATTERN, min_length=1, max_length=128)
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=80)


class GetRelationArgs(StrictArguments):
    person_id_a: str = Field(pattern=PERSON_ID_PATTERN, min_length=1, max_length=128)
    person_id_b: str = Field(pattern=PERSON_ID_PATTERN, min_length=1, max_length=128)

    @model_validator(mode="after")
    def validate_two_people(self) -> GetRelationArgs:
        if self.person_id_a == self.person_id_b:
            raise ValueError("person_id_a 与 person_id_b 不能是同一人")
        return self


class GetEraGraphArgs(StrictArguments):
    era_id: str | None = Field(default=None, max_length=64)
    scope_id: str | None = Field(default=None, max_length=64)
    center_person_id: str | None = Field(
        default=None, pattern=PERSON_ID_PATTERN, max_length=128
    )
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=80)

    @model_validator(mode="after")
    def validate_period_source(self) -> GetEraGraphArgs:
        if (self.era_id is None) == (self.scope_id is None):
            raise ValueError("era_id 与 scope_id 必须且只能提供一个")
        return self


class TimelineSpanArgs(StrictArguments):
    start_year: int
    end_year: int
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=80)

    @model_validator(mode="after")
    def validate_span(self) -> TimelineSpanArgs:
        if self.start_year == 0 or self.end_year == 0:
            raise ValueError("史书纪年不允许 0 年")
        if self.start_year > self.end_year:
            raise ValueError("start_year 不能晚于 end_year")
        return self


class SearchHistoricalTextArgs(StrictArguments):
    """RAG 史料检索参数（V1.0.5）：Token 控制是产品硬约束，top_k 上限 3。"""

    query: str = Field(min_length=1, max_length=200)
    top_k: int = Field(default=3, ge=1, le=3)


@dataclass(frozen=True)
class ToolSpec:
    """一个工具的静态定义：契约名 + 描述 + 严格参数模型。"""

    name: str
    description: str
    input_model: type[StrictArguments]

    def prompt_payload(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.input_model.model_json_schema(),
        }


class ToolRegistryError(RuntimeError):
    """工具名 / 参数不合法（会被转换成 `INVALID_REQUEST` 失败信封）。"""


class UnknownToolError(ToolRegistryError):
    pass


class InvalidToolArguments(ToolRegistryError):
    pass


_DESCRIPTIONS = {tool["name"]: tool["description"] for tool in CONTRACT_TOOLS}

SPECS: dict[str, ToolSpec] = {
    "resolve_entity": ToolSpec(
        "resolve_entity", _DESCRIPTIONS["resolve_entity"], ResolveEntityArgs
    ),
    "search_events": ToolSpec(
        "search_events", _DESCRIPTIONS["search_events"], SearchEventsArgs
    ),
    "get_event": ToolSpec("get_event", _DESCRIPTIONS["get_event"], GetEventArgs),
    "get_person": ToolSpec("get_person", _DESCRIPTIONS["get_person"], GetPersonArgs),
    "get_person_events": ToolSpec(
        "get_person_events", _DESCRIPTIONS["get_person_events"], GetPersonEventsArgs
    ),
    "get_relation": ToolSpec(
        "get_relation", _DESCRIPTIONS["get_relation"], GetRelationArgs
    ),
    "get_era_graph": ToolSpec(
        "get_era_graph", _DESCRIPTIONS["get_era_graph"], GetEraGraphArgs
    ),
    "timeline_span": ToolSpec(
        "timeline_span", _DESCRIPTIONS["timeline_span"], TimelineSpanArgs
    ),
    "search_historical_text": ToolSpec(
        "search_historical_text",
        _DESCRIPTIONS["search_historical_text"],
        SearchHistoricalTextArgs,
    ),
}

if set(SPECS) != set(TOOL_NAMES):  # pragma: no cover - 导入期自检
    raise RuntimeError("ToolRegistry 参数模型与工具实现白名单不一致")


def _format_validation_error(error: ValidationError) -> str:
    messages = []
    for item in error.errors():
        location = ".".join(str(part) for part in item.get("loc") or ()) or "arguments"
        messages.append(f"{location}: {item.get('msg', '参数不合法')}")
    return "；".join(messages)[:500]


class ToolRegistry:
    """白名单工具注册表 + 严格参数校验 + 执行入口。"""

    def __init__(self, toolkit: Toolkit) -> None:
        self._toolkit = toolkit
        self._specs = dict(SPECS)
        self._functions: dict[str, Callable[..., dict[str, Any]]] = {
            name: (lambda ctx, _name=name, **kwargs: toolkit.call(_name, **kwargs))
            for name in SPECS
        }

    @property
    def tool_names(self) -> tuple[str, ...]:
        return tuple(self._specs)

    def tool_catalog(self) -> list[dict[str, Any]]:
        """给 Prompt 用的工具目录（与校验模型同源）。"""

        return [spec.prompt_payload() for spec in self._specs.values()]

    def tool_catalog_json(self) -> str:
        return json.dumps(self.tool_catalog(), ensure_ascii=False, indent=2)

    def validate_arguments(
        self, name: str, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        """白名单 + 严格 Schema 校验；返回可直接传参的 kwargs。"""

        spec = self._specs.get(name)
        if spec is None:
            raise UnknownToolError(f"未知工具：{name}")
        if not isinstance(arguments, dict):
            raise InvalidToolArguments(
                f"arguments 必须是 JSON 对象，实际是 {type(arguments).__name__}"
            )
        try:
            validated = spec.input_model.model_validate(arguments)
        except ValidationError as exc:
            raise InvalidToolArguments(_format_validation_error(exc)) from exc
        return validated.model_dump(exclude_none=True)

    def execute(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """校验并执行；任何参数错误 / 工具内部异常都转成统一失败信封。

        P1-3：工具实现里的 KeyError / ValueError / 快照异常等**不得逃逸**到 API 层
        （否则会变成未预期的 500）。这里统一捕获并返回安全的 `INTERNAL` 信封，
        既让规划器能继续纠错，也不会把内部堆栈 / 异常信息回传给模型或用户。
        """

        try:
            kwargs = self.validate_arguments(name, arguments)
        except ToolRegistryError as exc:
            safe_name = (name or "unknown")[:100]
            return failure(
                self._toolkit.context, safe_name, ErrorCode.INVALID_REQUEST, str(exc)
            )
        except Exception:
            safe_name = (name or "unknown")[:100]
            logger.exception(
                "工具 %s 参数校验内部异常，已转换为安全失败信封", safe_name
            )
            return failure(
                self._toolkit.context,
                safe_name,
                ErrorCode.INTERNAL,
                "工具内部错误（已记录日志）",
            )
        function = self._functions[name]
        try:
            return function(self._toolkit.context, **kwargs)
        except Exception:
            safe_name = (name or "unknown")[:100]
            logger.exception("工具 %s 内部异常，已转换为安全失败信封", safe_name)
            return failure(
                self._toolkit.context,
                safe_name,
                ErrorCode.INTERNAL,
                "工具内部错误（已记录日志）",
            )


__all__ = [
    "DEFAULT_LIMIT",
    "SPECS",
    "InvalidToolArguments",
    "StrictArguments",
    "ToolRegistry",
    "ToolRegistryError",
    "ToolSpec",
    "UnknownToolError",
    "YearRange",
]
