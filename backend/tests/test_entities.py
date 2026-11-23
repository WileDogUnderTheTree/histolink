"""只读实体接口测试（V1.0.1 / TC-06）。"""

from __future__ import annotations

from typing import Any

import jsonschema
from fastapi.testclient import TestClient

LIANG_HAN = "p-liangtaihou-handong-90be"
LIANG_XIXIA = "p-liangtaihou-xixia-0d0f"


def _validate_against_contract(instance: Any, model: str, spec: dict[str, Any]) -> None:
    validator = jsonschema.Draft202012Validator({**spec, "$ref": f"#/components/schemas/{model}"})
    validator.validate(instance)


def test_get_person(client: TestClient, openapi_spec: dict[str, Any]) -> None:
    response = client.get(f"/api/entities/person/{LIANG_XIXIA}")
    assert response.status_code == 200
    payload = response.json()
    person = payload["person"]
    assert person["person_id"] == LIANG_XIXIA
    assert person["display_name"] == "梁太后"
    assert person["disambiguator"] == "西夏·毅宗后"
    assert "xixia" in person["era_ids"]
    assert person["first_year"] == 1081 and person["last_year"] == 1082
    assert 0 < len(person["events"]) <= 50
    event_ids = [event["event_id"] for event in person["events"]]
    assert "xixia-09" in event_ids
    years = [event["year"] for event in person["events"]]
    assert years == sorted(years)
    _validate_against_contract(payload, "PersonResponse", openapi_spec)


def test_get_person_same_name_two_records(client: TestClient) -> None:
    han = client.get(f"/api/entities/person/{LIANG_HAN}").json()["person"]
    xixia = client.get(f"/api/entities/person/{LIANG_XIXIA}").json()["person"]
    assert han["display_name"] == xixia["display_name"] == "梁太后"
    assert han["disambiguator"] != xixia["disambiguator"]
    assert han["person_id"] != xixia["person_id"]


def test_get_event(client: TestClient, openapi_spec: dict[str, Any]) -> None:
    response = client.get("/api/entities/event/xixia-09")
    assert response.status_code == 200
    payload = response.json()
    event = payload["event"]
    assert event["event_id"] == "xixia-09"
    assert event["title"] == "灵州之战"
    assert LIANG_XIXIA in event["person_ids"]
    assert event["source_status"] == "cited"
    assert event["source_refs"][0]["book"] == "宋史"
    assert event["source_refs"][0]["chapter"] == "夏国传"
    assert event["surface"] == {"timeline": True, "graph": True}
    _validate_against_contract(payload, "EventResponse", openapi_spec)


def test_special_event_is_explicit_easter_egg(client: TestClient) -> None:
    event = client.get("/api/entities/event/special-star-1893").json()["event"]
    assert event["is_special"] is True
    assert event["source_refs"] == []
    assert event["source_status"] == "easter_egg"
    assert event["surface"] == {"timeline": True, "graph": False}


def test_graph_only_weijin_event_surface(client: TestClient) -> None:
    event = client.get("/api/entities/event/weijin-zhulin").json()["event"]
    assert event["surface"] == {"timeline": False, "graph": True}


def test_find_persons_returns_two_candidates(client: TestClient, openapi_spec: dict[str, Any]) -> None:
    response = client.get("/api/entities/persons", params={"name": "梁太后"})
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["candidates"]) == 2
    candidates = payload["candidates"]
    assert {candidate["person_id"] for candidate in candidates} == {LIANG_HAN, LIANG_XIXIA}
    assert all(candidate["disambiguator"] for candidate in candidates)
    assert len({candidate["disambiguator"] for candidate in candidates}) == 2
    _validate_against_contract(payload, "PersonCandidatesResponse", openapi_spec)


def test_find_persons_filters_by_era(client: TestClient) -> None:
    payload = client.get("/api/entities/persons", params={"name": "梁太后", "era_id": "xixia"}).json()
    assert len(payload["candidates"]) == 1
    assert payload["candidates"][0]["person_id"] == LIANG_XIXIA


def test_find_persons_resolves_global_alias(client: TestClient) -> None:
    payload = client.get("/api/entities/persons", params={"name": "唐太宗"}).json()
    assert payload["candidates"], "别名「唐太宗」必须能解析到李世民"
    assert payload["candidates"][0]["display_name"] == "李世民"


def test_find_persons_unknown_returns_empty(client: TestClient) -> None:
    payload = client.get("/api/entities/persons", params={"name": "不存在的人物"}).json()
    assert payload["candidates"] == []
