"""快照加载与只读查询（V1.0.1 / TC-06）。

启动时一次性加载 `backend/data/snapshot.v1.json` + `snapshot.meta.json`：
- 校验 schema / counts / 内容 hash / 许可，任一不符直接 fail-fast（服务不启动）；
- 建立只读索引（person_id / event_id / 姓名候选），请求期不再线性扫描；
- **不提供任何写操作**，也不访问数据库。

前端页面在 V1.0 仍读 TS 数据；本模块只服务 API / 工具层。
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from contracts.action_types import V1_AVAILABLE_ACTIONS
from contracts.models import (
    API_VERSION,
    SCHEMA_VERSION,
    ApiEvent,
    ApiPerson,
    Capabilities,
    EventResponse,
    EventSummary,
    EventSurface,
    MetaCounts,
    MetaResponse,
    MetaSnapshot,
    PersonCandidate,
    PersonCandidatesResponse,
    PersonResponse,
    SnapshotMeta,
    SourceRefModel,
)

#: 单个人物返回的事件摘要上限（TC-06 验收）。
PERSON_EVENT_LIMIT = 50
#: 姓名候选上限。
PERSON_CANDIDATE_LIMIT = 20


class SnapshotLoadError(RuntimeError):
    """快照缺失 / 损坏 / 与元数据不一致；应用启动必须失败。"""


def _format_year(year: int) -> str:
    return f"前{abs(year)}年" if year < 0 else f"{year}年"


@dataclass(frozen=True)
class SnapshotStore:
    """不可变快照 + 只读索引。"""

    snapshot: dict[str, Any]
    meta: dict[str, Any]
    persons_by_id: dict[str, dict[str, Any]]
    events_by_id: dict[str, dict[str, Any]]
    persons_by_name: dict[str, list[dict[str, Any]]]

    # ------------------------------------------------------------------
    # 加载与校验
    # ------------------------------------------------------------------
    @classmethod
    def load(cls, snapshot_path: Path, meta_path: Path) -> SnapshotStore:
        if not snapshot_path.exists():
            raise SnapshotLoadError(
                f"快照文件不存在：{snapshot_path}。请先运行 node scripts/export-snapshot.mjs"
            )
        if not meta_path.exists():
            raise SnapshotLoadError(
                f"快照元数据不存在：{meta_path}。请先运行 node scripts/export-snapshot.mjs"
            )

        raw = snapshot_path.read_bytes()
        try:
            snapshot = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SnapshotLoadError(
                f"快照不是合法 UTF-8 JSON：{snapshot_path}（{exc}）"
            ) from exc

        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise SnapshotLoadError(
                f"快照元数据不是合法 UTF-8 JSON：{meta_path}（{exc}）"
            ) from exc

        if snapshot.get("schema_version") != "snapshot.v1":
            raise SnapshotLoadError(
                f"快照 schema_version 非法：{snapshot.get('schema_version')}"
            )
        if meta.get("schema_version") != "snapshot.v1":
            raise SnapshotLoadError(
                f"元数据 schema_version 非法：{meta.get('schema_version')}"
            )

        actual_hash = hashlib.sha256(raw).hexdigest()
        if meta.get("content_hash") != actual_hash:
            raise SnapshotLoadError(
                "快照内容 hash 与 snapshot.meta.json 不一致（数据可能被手改或导出不完整）："
                f"meta={meta.get('content_hash')} actual={actual_hash}"
            )
        if meta.get("snapshot_version") != snapshot.get("snapshot_version"):
            raise SnapshotLoadError(
                "快照版本与元数据不一致："
                f"{snapshot.get('snapshot_version')} vs {meta.get('snapshot_version')}"
            )
        if meta.get("counts") != snapshot.get("counts"):
            raise SnapshotLoadError("快照 counts 与元数据 counts 不一致")
        if meta.get("license") != "CC BY-NC-SA 4.0":
            raise SnapshotLoadError(f"快照许可声明非法：{meta.get('license')}")

        counts = snapshot.get("counts") or {}
        for key, payload_key in (
            ("events", "events"),
            ("persons", "persons"),
            ("relations", "relations"),
            ("eras", "eras"),
            ("scopes", "scopes"),
            ("groups", "groups"),
            ("aliases", "aliases"),
        ):
            actual = len(snapshot.get(payload_key) or [])
            if counts.get(key) != actual:
                raise SnapshotLoadError(
                    f"快照 counts.{key}={counts.get(key)} 与数组长度 {actual} 不一致"
                )

        persons_by_id = {
            person["person_id"]: person for person in snapshot.get("persons") or []
        }
        events_by_id = {
            event["event_id"]: event for event in snapshot.get("events") or []
        }
        if len(persons_by_id) != len(snapshot.get("persons") or []):
            raise SnapshotLoadError("快照 persons 存在重复 person_id")
        if len(events_by_id) != len(snapshot.get("events") or []):
            raise SnapshotLoadError("快照 events 存在重复 event_id")

        persons_by_name: dict[str, list[dict[str, Any]]] = {}
        for person in persons_by_id.values():
            for name in [person["display_name"], *(person.get("aliases") or [])]:
                persons_by_name.setdefault(name, []).append(person)

        # 引用完整性：事件 person_id 必须可解析、人物 event_id 必须可解析。
        for event in events_by_id.values():
            for person_id in event.get("person_ids") or []:
                if person_id not in persons_by_id:
                    raise SnapshotLoadError(
                        f"事件 {event['event_id']} 引用了不存在的人物 {person_id}"
                    )
        for person in persons_by_id.values():
            for event_id in person.get("event_ids") or []:
                if event_id not in events_by_id:
                    raise SnapshotLoadError(
                        f"人物 {person['person_id']} 引用了不存在的事件 {event_id}"
                    )

        return cls(
            snapshot=snapshot,
            meta=meta,
            persons_by_id=persons_by_id,
            events_by_id=events_by_id,
            persons_by_name=persons_by_name,
        )

    # ------------------------------------------------------------------
    # 公共视图
    # ------------------------------------------------------------------
    @property
    def snapshot_meta(self) -> SnapshotMeta:
        counts = self.meta["counts"]
        return SnapshotMeta(
            version=self.meta["snapshot_version"],
            hash=f"sha256:{self.meta['content_hash']}",
            events=counts["events"],
            persons=counts["persons"],
        )

    def get_meta(self) -> MetaResponse:
        counts = self.meta["counts"]
        return MetaResponse(
            api_version=API_VERSION,
            schema_version=SCHEMA_VERSION,
            snapshot=MetaSnapshot(
                version=self.meta["snapshot_version"],
                hash=f"sha256:{self.meta['content_hash']}",
                counts=MetaCounts(
                    events=counts["events"],
                    persons=counts["persons"],
                    relations=counts["relations"],
                    eras=counts["eras"],
                    scopes=counts["scopes"],
                    groups=counts["groups"],
                    aliases=counts["aliases"],
                ),
            ),
            capabilities=Capabilities(
                actions=list(V1_AVAILABLE_ACTIONS),
                clarification=True,
            ),
        )

    # ------------------------------------------------------------------
    # 人物 / 事件
    # ------------------------------------------------------------------
    @staticmethod
    def _disambiguator(person: dict[str, Any]) -> str:
        disambiguator = person.get("disambiguator") or {}
        period = (
            disambiguator.get("period") or person.get("primary_dynasty") or "时期未详"
        )
        role = disambiguator.get("role")
        return f"{period}·{role}" if role else str(period)

    def _event_summary(self, event: dict[str, Any]) -> EventSummary:
        return EventSummary(
            event_id=event["event_id"],
            title=event["title"],
            dynasty=event["dynasty"],
            year=event["year"],
            importance=event.get("importance"),
        )

    def get_person(self, person_id: str) -> PersonResponse | None:
        person = self.persons_by_id.get(person_id)
        if person is None:
            return None
        events = [
            self.events_by_id[event_id]
            for event_id in person.get("event_ids") or []
            if event_id in self.events_by_id
        ]
        events.sort(key=lambda event: (event["year"], event["event_id"]))
        return PersonResponse(
            snapshot=self.snapshot_meta,
            person=ApiPerson(
                person_id=person["person_id"],
                display_name=person["display_name"],
                romanized=person["romanized"],
                disambiguator=self._disambiguator(person),
                aliases=list(person.get("aliases") or []),
                primary_dynasty=person["primary_dynasty"],
                dynasties=list(person.get("dynasties") or []),
                era_ids=list(person.get("era_ids") or []),
                scope_ids=list(person.get("scope_ids") or []),
                first_year=person["first_year"],
                last_year=person["last_year"],
                events=[
                    self._event_summary(event) for event in events[:PERSON_EVENT_LIMIT]
                ],
            ),
        )

    def get_event(self, event_id: str) -> EventResponse | None:
        event = self.events_by_id.get(event_id)
        if event is None:
            return None
        surface = event.get("surface") or {"timeline": False, "graph": False}
        return EventResponse(
            snapshot=self.snapshot_meta,
            event=ApiEvent(
                event_id=event["event_id"],
                title=event["title"],
                dynasty=event["dynasty"],
                year=event["year"],
                description=event["description"],
                importance=event.get("importance"),
                is_special=bool(event.get("is_special")),
                person_ids=list(event.get("person_ids") or []),
                source_refs=[
                    SourceRefModel(**ref) for ref in event.get("source_refs") or []
                ],
                source_status=event.get("source_status", "cited"),
                surface=EventSurface(
                    timeline=bool(surface.get("timeline")),
                    graph=bool(surface.get("graph")),
                ),
            ),
        )

    def find_persons(
        self,
        name: str,
        *,
        era_id: str | None = None,
        limit: int = PERSON_CANDIDATE_LIMIT,
    ) -> PersonCandidatesResponse:
        matched = self.persons_by_name.get(name, [])
        candidates: list[PersonCandidate] = []
        seen: set[str] = set()
        for person in matched:
            person_id = person["person_id"]
            if person_id in seen:
                continue
            if (
                era_id
                and era_id not in (person.get("era_ids") or [])
                and era_id not in (person.get("scope_ids") or [])
            ):
                continue
            seen.add(person_id)
            first_event = None
            for event_id in person.get("event_ids") or []:
                event = self.events_by_id.get(event_id)
                if event and (
                    first_event is None or event["year"] < first_event["year"]
                ):
                    first_event = event
            hint = (
                f"{_format_year(first_event['year'])}·{first_event['title']}"
                if first_event is not None
                else None
            )
            candidates.append(
                PersonCandidate(
                    person_id=person_id,
                    display_name=person["display_name"],
                    disambiguator=self._disambiguator(person),
                    primary_dynasty=person["primary_dynasty"],
                    era_ids=list(person.get("era_ids") or []),
                    hint=hint,
                )
            )
            if len(candidates) >= limit:
                break
        return PersonCandidatesResponse(
            snapshot=self.snapshot_meta,
            query=name,
            candidates=candidates,
        )
