# backend/data · 数据快照（V1.0.1 / TC-05）

本目录是**构建产物**：由 `scripts/export-snapshot.mjs` 从前端 `frontend/data/*.ts`
导出，供后端只读服务加载。**禁止手改**，改数据请改 TS 数据模块后重新生成。

## 文件

| 文件 | 说明 |
|---|---|
| `snapshot.v1.json` | 单一 JSON 快照：events / persons / relations / eras / scopes / groups / aliases / indexes |
| `snapshot.meta.json` | `schema_version`、`snapshot_version`（内容寻址）、`generated_at`、`content_hash`（sha256）、`counts`、`license`、`attribution` |

ID 锁文件在 `frontend/data/locks/`：`person-ids.lock.json`（人物）、`event-ids.lock.json`（事件）。

## 生成与校验

```bash
# 仓库根目录
node scripts/export-snapshot.mjs          # 生成（会重写 generated_at）
node scripts/export-snapshot.mjs --check  # 只校验：生成物过期 / 手改即失败
node scripts/validate-data.mjs            # 校验快照内部一致性
```

`--check` 对 `snapshot.v1.json` 与 `event-ids.lock.json` 做字节级比较；对 `snapshot.meta.json`
忽略 `generated_at`（这是唯一每次生成都会变化的字段）。

## 快照字段

- `schema_version`：固定 `snapshot.v1`；`snapshot_version`：`v1-<sha256 前 12 位>`（内容寻址）；
- `events[]`：原字段 + `person_ids[]` + `source_refs[]` + `source_status` + `surface{timeline,graph}`；
- `persons[]`：`person_id` / `display_name` / `disambiguator` / `aliases[]` / `primary_dynasty` /
  `dynasties[]` / `era_ids[]` / `scope_ids[]` / `event_ids[]` / `first_year` / `last_year` / `status`；
- `relations[]`：`pair_key` / `person_id_a` / `person_id_b` / `label` / `description?` /
  `event_summaries` / `basis_event_ids[]`（共同事件，供引用构造）/ `attribution`；
- `eras[]`（18 期）/ `scopes[]`（7 组）：`id/label/dynasties/default_center_person_id/graph{nodes,edges}`，
  节点 `person_id + name` 双写；异名同一人合并后节点按 `person_id` 去重、自环边丢弃；
- `groups[]`（7 大断代）、`aliases[]`（66 条）；
- `indexes`：`name_to_persons` / `person_to_eras` / `event_to_dynasty` / `era_members`。

## 约束

- 快照是**同一批 TS 数据模块**的投影，前后端同源；页面渲染在 V1.0 仍读 TS；
- 预算：< 5MB、Node 加载 < 300ms（当前约 2.9MB）；
- 数据许可：沿用 shiji-kb 的 CC BY-NC-SA 4.0，非商用；`meta.license` / `meta.attribution` 随快照下发。
