# 评测夹具（V1.0.1 / TC-09）

> 目标：在 Agent 代码开工前，先把「什么问题、期望命中什么实体 / 事件 / 动作、按什么口径算通过」冻结成可执行夹具。
> 本版只跑 **contract 模式**（离线校验，不调用 LLM）；真实评分在 V1.0.3 接入。

## 1. 文件

| 文件 | 说明 |
|---|---|
| `golden.v1.json` | 30 条 golden 用例；文件头绑定 `snapshot.version / hash / counts` |
| `schema.json` | 用例字段 JSON Schema（draft 2020-12），由 Ajv 校验 |
| `../scripts/run-evals.mjs` | 运行器：`--mode contract` / `--mode live` |
| 本文 | 分类、评分口径、新增用例流程 |

## 2. 运行

```powershell
# 仓库根目录；contract 模式（CI / verify.ps1 使用）
node scripts/run-evals.mjs --mode contract

# live 模式：V1.0.1 打印「未实现」并退出 0（避免 CI 红）；V1.0.3 起接真实问答
node scripts/run-evals.mjs --mode live
```

`scripts/verify.ps1` 的第 11 步就是 `run-evals --mode contract`。

## 3. 30 条覆盖矩阵

| 类别 | 条数 | 用例 | 关键断言 |
|---|---:|---|---|
| `bc_year` 公元前年份 | 3 | 秦统一、长平之战、孔子卒 | 年份与事件 ID 精确 |
| `ambiguous_name` 同名歧义 | 4 | 梁太后（无/有上下文）、刘崇（无/有上下文） | 无上下文 → 2 候选澄清，禁止默认第一条；有上下文 → 唯一人 |
| `insufficient` 无结果 / 资料不足 | 3 | 数据外人物、日常细节、伤亡数字 | `answer_mode=insufficient` + `missing` |
| `cross_dynasty` 跨朝代 | 3 | 曹操、杨坚、赵匡胤 | 同一人物跨分期事件均可解析 |
| `relation` 关系 | 4 | 王阳明×朱熹、刘邦×项羽、曹操×刘备、康熙×乾隆 | 关系定性 / 共同事件书目；未收录关系回退共同事件 |
| `comparison` 对比 | 3 | 秦始皇×汉武帝、汉武帝×唐太宗、康熙×乾隆 | 多人取数 + 分点对比 |
| `out_of_scope` 超范围 | 2 | 写代码、问天气 | `refusal` + `OUT_OF_SCOPE` |
| `easter_egg` 彩蛋排除 | 1 | 1893 彩蛋事件 | `excluded_event_ids`；不得作为史实引用 |
| `graph_only_event` 仅图谱事件 | 1 | 白袍北伐（`weijin-*`） | `surface.timeline=false`；回答须标注仅图谱 |
| `multi_turn` 多轮承接 | 2 | 梁太后、杨坚追问 | `history` + `context.person_id` 承接上一轮澄清 |
| `event_person_link` 事件+人物联动 | 2 | 赤壁×周瑜、玄武门×李世民 | 同页动作 auto、跨页动作 confirm |
| `ui_action` UI 动作策略 | 2 | 同页换中心、跨页查看岳飞 | 动作类型 / surface / auto·confirm 与 `action-policy.json` 一致 |

## 4. contract 模式校验什么

1. **schema**：`golden.v1.json` 通过 `schema.json`；30 条、12 类计数与 `category_counts` 一致。
2. **快照绑定**：文件头 `snapshot.version / hash / counts` 与 `backend/data/snapshot.meta.json` 完全一致；数据变化必须显式更新用例版本。
3. **ID 可解析**：`entity_ids` / `event_ids` / `context.*` / `clarification_candidates` / `relation_pair` 全部命中快照，0 悬空。
4. **工具入参**：每个 `tool_calls[].args` 通过 `contracts/tools-v1.schema.json` 对应工具的 input schema。
5. **动作契约**：动作类型必须 `available`；`action_target_surfaces` 与策略一致；`action_decisions` 按「target.surface === 当前路由 → auto，否则 confirm」推导。
6. **回答语义自洽**：`grounded` 必须有 facts；`insufficient` 必须写 missing；`refusal` 必须给 reason_code；澄清必须 ≥2 候选且不带 facts。
7. **引用纪律**：`citation_required` 的 fact 必须引用有结构化出处（`source_status=cited` 且 `source_refs` 非空）的事件；彩蛋事件禁止作为 fact 引用。
8. **负向自测**：运行器会篡改一条用例的 `entity_id` / `event_id` 再跑同一套校验，**必须被拦截**，否则退出 1（防止校验器形同虚设）。

## 5. 评分口径（V1.0.3 起 live 模式）

只比对**结构化字段**，不比对自由文本：

| 维度 | 权重建议 | 说明 |
|---|---|---|
| 工具命中 | 20% | 期望工具集合 ⊆ 实际调用集合（允许额外一次检索） |
| 实体 / 事件命中 | 25% | `entity_ids / event_ids` 全命中，且无悬空 |
| 动作策略 | 20% | 动作类型、target surface、auto/confirm 全对 |
| 回答模式 | 15% | grounded / insufficient / refusal 判对 |
| 引用覆盖 | 15% | 每条 claim 绑定有效 citation；彩蛋 / 无出处事件不得成为史实 |
| 澄清质量 | 5% | 同名候选 ≥2、不默认第一条、上下文收敛正确 |

live 模式在 V1.0.3 引入，默认 temperature=0，固定题集跑 3 次取稳定结果；不做逐字比对。

## 6. 如何新增 / 修改用例

1. 先确认引用 ID 在快照中存在（`/api/entities/*` 或 `backend/data/snapshot.v1.json`）。
2. 在 `golden.v1.json` 增加用例，保持 `id` 唯一、`category` 合法、`category_counts` 同步。
3. 跑 `node scripts/run-evals.mjs --mode contract`；失败信息会指出悬空 ID / 字段与策略不一致的位置。
4. **数据快照变化时**：更新文件头 `snapshot.version / hash / counts`，并在 CHANGELOG 记录评测版本升级；不得只改 hash 不管用例。
5. 30 条是 V1.0.1 的下限；V1.0.3 起扩到 50 条（新增检索、引用校验、多轮记忆类）。

> 原则：golden 用例是**契约的回归测试**，不是「模型能力展示」。宁可少一条，不可留一条引用悬空或口径含糊的用例。
