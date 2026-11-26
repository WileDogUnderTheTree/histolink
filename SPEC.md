# SPEC｜史脉 HistoLink 产品规格（V1.0.7 实现基线）

> **状态**：V1.0.7 发版基线。本文档描述 V1.0 系列**已经实现并验收**的产品行为、数据约束与验收标准，
> 作为后续维护、回归与迭代的规格依据。V0.1 的原始需求文档已归档至
> [docs/archive/SPEC-v0.1-original.md](docs/archive/SPEC-v0.1-original.md)。
>
> **原则**：实现中出现本文未覆盖的行为，先补 SPEC 再改代码；本文与代码冲突时以代码为准并回写本文。

---

## 1. 产品概述

### 1.1 一句话

面向中文用户的中国历史探索 Web 应用：以**结构化历史数据**（全朝代时间轴 + 人物关系图谱）为主干，
以**可核验的智能问答**（「史令 / 史引」双人格）为入口，用服务端强制的证据链校验保证「无史料依据绝不编造」。

### 1.2 目标

| 编号 | 目标 | 衡量方式 |
|---|---|---|
| G1 | 三个主模块（时间轴 / 人物图谱 / 智能问答）各自好用，且能互相跳转 | 任一模块内 2 次点击可达关联实体；问答动作可驱动 UI 联动 |
| G2 | 历史信息可核验 | grounded 回答必须绑定本轮工具真实返回的 evidence / citation；正文中的年份 / 人物 / 书名 / 引文必须可核验 |
| G3 | 易错点行为明确 | 公元前年份、人物重名、图谱分期隔离、资料不足与拒答均有确定性行为（§12 验收用例） |
| G4 | 数据与模型均可本地化 | 断开外网仍可浏览时间轴与图谱；接入本机 Ollama 后问答数据不出本机 |

### 1.3 非目标（V1.0 明确不做）

- 不做用户账号、登录、云端同步、多人协作；不做英文版。
- 不做二十四史全文检索库、古汉语翻译、年号自动换算引擎。
- 不做 AI 生成插图 / 地图 / 视频；不做移动端优先设计（桌面优先，窄屏保证可浏览）。
- 不做 3D 关系图与时间轴滑块——规划在 V1.1（§13）。
- 不做史实自动审核：内容质量靠人工校订 + 结构化校验兜底。

### 1.4 目标用户

对中国历史有兴趣的非专业用户：能看懂朝代顺序，但记不住具体年份与人物关系；希望「点着看」而不是读长文。

---

## 2. 范围

### 2.1 历史范围

- 覆盖 **约公元前 2070 年（夏，传统纪年）→ 1912 年（清亡）**，全朝代均需有内容，每朝只精选关键人物与事件。
- 1912 年之后不涉及近现代叙述；时间轴尽头设一枚致敬彩蛋节点（1893-12-26）。

### 2.2 数据规模（V1.0.7 快照实况）

| 数据 | 数量 |
|---|---|
| 时间轴事件 | 896 条（时间轴 862 + 仅进人物图 34） |
| 人物主数据 | 1,217 人（1,218 个姓名，同名组 2，全局别名 86 条） |
| 人物关系 | 840 对人工裁定关系 |
| 朝代 / 断代 | 23 个朝代 / 时期 · 7 大断代 |
| 人物图谱 | 21 期细览 + 7 组简阅（28 张图）· 2,715 节点位 · 5,112 条边 · 2,367 去重人物对 |
| 结构化引用 | 853 条有据事件 · 1,182 条引用（657 单书 + 196 双书）· 411 个标签 |
| RAG 语料 | 90 篇 · 360 条 ≤500 字 chunk |

### 2.3 平台与形态

- Web 应用，桌面 Chrome / Edge 最近两个大版本为主，Safari 16+ 可浏览；窄屏降级为可浏览。
- 前后端分离：前端 Next.js（App Router）+ React + TypeScript；后端 FastAPI（Python 3.11）。
- 页面渲染数据读前端 TS 数据模块；后端加载**同一内容哈希**的只读快照提供 API，不接内容数据库。
- 唯一持久化数据库是**会话库**（SQLite，`backend/data/sessions.v1.sqlite`），且可整体删除重建。

### 2.4 范围外

见 §1.3。另：不处理农历 / 公历互转；不实现关系事实自动抽取（人工校订）；不做运行时爬取。

---

## 3. 信息架构与路由

### 3.1 路由表

| 路由 | 模块 | 可带参数（均支持深链接与浏览器前进 / 后退） |
|---|---|---|
| `/` | 首页 | — |
| `/timeline` | 全朝代时间轴 | `?event=&dynasty=&group=&mode=` |
| `/graph` | 人物关系图 | `?person=&era=&selected=&mode=` |
| `/ask` | 智能问答（史令 / 史引） | `?session_id=&panel=timeline\|graph` |

### 3.2 全局形态

- 右下角「问史脉」悬浮抽屉与 `/ask` 页面**共享同一份会话事实**（`AgentContext` 单一数据源）。
- 首页实时显示后端连通状态；时间轴与图谱为纯前端数据，后端离线仍可用。
- 页脚与引用区展示数据来源许可（CC BY-NC-SA 4.0 署名）。

### 3.3 跨模块联动（问答驱动 UI）

| 动作类型 | 目标界面 | 语义 | 可用性 |
|---|---|---|---|
| `timeline.focus_event` | 时间轴 | 切朝代 + 选中事件 + 滚动定位 | available |
| `timeline.focus_dynasty` | 时间轴 | 切断代 / 分组 | available |
| `graph.focus_person` | 人物图 | 以该人物为中心重布局 | available |
| `graph.focus_relation` | 人物图 | 选中两人关系 | available |
| `ask.suggest` | 问答 | 建议追问问题 | available |

- **同页自动执行，跨页必须用户确认**：前端按 `target.surface === 当前路由` 判定，服务端 `auto` 仅为建议值。
- 一句提问可同时命中时间轴 + 人物图两侧动作（双图联动）：左侧对话气泡并排渲染「查看人物图谱 / 查看时间轴」，
  右侧「史引」副驾驶面板相应切换视图。
- 未知动作类型静默忽略；动作引用的 ID 不在本地数据时不执行并提示刷新，绝不白屏。

---

## 4. 数据层

### 4.1 数据来源与许可

| 来源 | 内容 | 许可 |
|---|---|---|
| [shiji-kb](https://github.com/baojie/shiji-kb) | 结构化《史记》事件索引与原文引用 | **CC BY-NC-SA 4.0**（非商业、署名、相同方式共享） |
| 正史（《汉书》《三国志》《晋书》《明史》等） | 事件与人物表述依据 | 公有领域 |
| [chinese-history](https://github.com/anthonyhann/chinese-history) | 朝代起始年、年号与公元纪年口径 | CC0 1.0 |
| 项目人工校订 | `docs/01_先秦.md`–`06_元明清.md` 等事件 / 人物关系表 | 本项目整理，随数据许可 |

> 数据仅用于个人学习、研究与非商业演示；任何再分发 / 改编须署名并以相同许可共享。代码以 MIT 许可。

### 4.2 数据形态与生成物

- **人工事实源**：`docs/01_先秦.md`–`06_元明清.md`（事件表）、`docs/史脉_*.md`（图谱扩充 / 关系语料）、
  `frontend/data/person-overrides.ts`（同名裁决层，唯一允许手改的人物数据）。
- **确定性生成物**（禁止手改，`--check` 校验）：
  `frontend/data/timeline-events.ts`、`timeline-participants.ts`、`person-graph.ts`、`person-relations.ts`、
  `persons.generated.ts`、`event-sources.ts`、`ingested-graph-data.generated.ts`、
  `frontend/data/locks/{person-ids,event-ids,data-counts}.lock.json`、
  `backend/data/snapshot.{v1.json,meta.json}`、`contracts/*`。
- **内容寻址**：快照带 sha256 `content_hash` 与 `snapshot_version`（`v1-<hash>`）；所有 ID 一经发布只增不改，
  新增人物使用可读固定 ID（如 `p-xizhou-zhoudinggong-01`），避免参与人补全导致 hash 漂移。

### 4.3 年份模型（铁律）

- 年份统一存**有符号整数**，**不存在公元 0 年**：公元前 N 年存 `-N`（前 221 → `-221`），公元 N 年存 `N`；`0` 非法。
- 运算用天文纪年，展示用史书纪年：

  ```
  A(y) = y < 0 ? y + 1 : y      // 史书纪年 → 天文纪年（运算 / 线性映射）
  Y(a) = a <= 0 ? a - 1 : a     // 天文纪年 → 史书纪年（展示）
  ```

  两时点间隔 = `A(y2) - A(y1)`；**禁止**直接用 `y2 - y1`（跨纪年会多算 1 年）。
- 精确度必填：`exact | circa | decade | century | unknown`；`circa` 展示为「约公元前 N 年」。
- 展示统一走 `frontend/lib/year.ts`，禁止各模块自行拼字符串；区间跨纪元两端带纪元，同纪元首端带纪元。
- 夏商周早期年份标「约」，前 841 年（共和元年）起为确切纪年；时间轴 x 轴用天文纪年线性映射，无 0 年跳变。

### 4.4 时期 / 图谱分期模型

- 时间轴：23 个朝代 / 时期，按 7 大断代分组（先秦 / 秦汉 / 三国 / 魏晋南北朝 / 隋唐 / 五代辽宋夏金 / 元明清）。
- 人物图：细览 21 期（夏 / 商 / 西周 / 春秋 / 战国 / 秦汉 / 三国 / 西晋 / 东晋十六国 / 南北朝 / 隋 / 唐 /
  五代十国 / 北宋 / 南宋 / 辽 / 西夏 / 金 / 元 / 明 / 清）+ 简阅 7 组（与断代对齐）。
- **图谱分期隔离规范**：节点必须锚定当期声明的朝代；秦汉图截止 184 年（黄巾起义前），三国图自 188 年起；
  默认中心必须在当期名人堂池内；`validate-data` 校验 0 孤儿节点、0 悬空边、跨期串期。

### 4.5 人物模型与消歧

- 主键 `person_id` 稳定不可变（`p-<slug>-<hash>` 或可读固定 ID），所有引用（关系边、事件参与者、深链接、会话实体）
  一律用 `person_id`，**禁止以姓名作键**。
- 展示名允许重复；同名人物必须有 `disambiguator`（时期 · 身份），如「梁太后」（西夏）/「梁太后」（东汉）。
- 别名表（字、号、谥号、庙号）用于搜索与问答实体对齐（「孟德」→ 曹操、「清圣祖」→ 康熙帝）。
- 构建期输出同名组报告 `docs/person-same-name-report.md`，人工裁决写入 `person-overrides.ts` 后重新生成。

### 4.6 事件模型

- 字段：`event_id`、`title`、`year`、`dynasty`、`summary`、`participants[]`、`source_refs[]`、`importance`。
- `importance`：3 = 简阅必须（断代大势，当前 178 条）、2 = 细览重要、1 = 补充。
- 事件简述必须带出处括注（如「据《史记·周本纪》」）；`validate-data` 对缺失出处报 warning。
- 34 条图谱补足事件只进人物图、不进时间轴（`frontend/data/weijin-events.ts`）。

### 4.7 关系模型

- 关系以**人物对 + 定性 + 共同事件锚点**表达：每条关系必须绑定至少 1 个共同事件，不允许凭空生成边。
- 图谱边权重 = 两人共同事件数；边由事件参与者自动派生，关系库提供定性文案与逐事件简述。
- 关系定性为人工裁断（当前 840 对覆盖 1,860 条图谱边），存在可讨论空间，属数据质量持续改进项。

### 4.8 引用与 RAG 语料模型

- **引用（Citation）**：`id / kind / event_id|person_id / title / source_label / source_ref / attribution / license`；
  正文引用必须绑定本轮工具真实返回的 citation。
- **RAG chunk**：以 `## 事件名` 为锚点切分，≤500 字（目标 300–500），带 `event_name / record_type=正史|传说 /
  section / source / 年份区间`；90 篇语料 → 360 chunk，事件名对齐图谱 `event_id`。
- **向量库**：chromadb 0.4.24（Windows 兼容性锁定）+ fastembed `BAAI/bge-small-zh-v1.5`（本地 ONNX CPU）；
  `manifest.json` 记录 provider / model / dim / 语料指纹，换 provider 必须整库重建。
- 向量库 `backend/data/chroma_db/` 为构建产物、不入库，重建脚本见 README「数据入库脚本」。

### 4.9 数据校验与生成管线

| 步骤 | 脚本 | 说明 |
|---|---|---|
| 数据校验 | `scripts/validate-data.mjs` | 事件 / 图谱隔离 / 关系 / 别名 / 名人堂 / docs 六层校验 |
| 人物主数据 | `scripts/build-persons.mjs`（`--check`） | 生成 `persons.generated.ts` + ID 锁 + 同名报告 |
| 引用结构化 | `scripts/extract-sources.mjs`（`--check`） | 生成 `event-sources.ts` + `source-review.md` |
| 快照导出 | `scripts/export-snapshot.mjs`（`--check`） | 生成 `snapshot.v1.json` / meta / 计数锁 |
| 图谱入库 | `backend/scripts/ingest_graph_data.py`（`--check`） | 解析 docs 扩充表 → 合并 → 重建快照 → 一致性检查 |
| RAG 入库 | `backend/scripts/ingest_rag.py` | 语料 → chunk → embedding → chromadb + 自检检索 |
| 契约导出 | `backend/scripts/export_contracts.py`（`--check`） | OpenAPI 3.1 / Actions / Tools 三份契约 |

所有生成物确定性排序、可重复生成；`--check` 模式只比对不写盘，是 `scripts/verify.ps1` 门禁的一部分。

### 4.10 快照与版本

- 快照字段：`schema_version="snapshot.v1"`、`snapshot_version`、`generated_at`、`content_hash`、`counts`、`files`。
- 后端启动时校验快照 hash / counts，失败即拒绝启动（`SNAPSHOT_NOT_LOADED` / `SNAPSHOT_MISMATCH`）。
- 全量冻结计数由 `frontend/data/locks/data-counts.lock.json` 统一提供，禁止散落魔法数字。

---

## 5. 模块一：全朝代时间轴（`/timeline`）

### 5.1 目标

在不阅读长文的前提下快速建立「朝代—事件」的时空直觉，并能定位到具体事件的史料出处。

### 5.2 能力

- **简阅 / 细览双模式**：简阅只显示 `importance === 3` 的 178 条断代大势；细览显示 862 条全部事件。
- **错层展示**：圆点按年份映射到轨道后贪心上下错层，自动计算步长与轨道高度，密集朝代自动缩小圆点，保证不重叠。
- **朝代 Tab**：按数据自动推导、按起始年排序；Tab 多时横向滚动、隐藏滚动条、两端渐隐箭头，支持按住拖拽 + 惯性滑行。
- **事件详情**：点击圆点原地弹卡（不整页跳转），展示年份、朝代、简述与出处；古早年份标「约」。
- **深链接**：`/timeline?event=<id>&dynasty=<id>&mode=simple|detail` 精确恢复选中与滚动位置。

### 5.3 关键算法与规则

- 年份 → x 坐标统一用天文纪年线性映射；同朝代内事件按年份单调，无 0 年跳变。
- 简阅 / 细览切换或切朝代时，尽量保留当前选中事件；事件不在当前视图时清空选中而非错位高亮。
- 时间轴末尾渲染特殊节点（1893-12-26 彩蛋），带致敬横幅，不参与历史事件统计。

### 5.4 验收

见 §12-A、§12-C。

---

## 6. 模块二：人物关系图（`/graph`）

### 6.1 目标

用可视化的关系网络回答「他们是什么关系」「这个时期有哪些人」，并支持从任意人物出发自由探索。

### 6.2 形态与交互

- **D3.js `forceSimulation` + SVG 2D 力导向图**（V1.0 不做 3D）；节点半径 / 标签 / 连线随画布自动适配。
- **三栏布局**：左栏（人物搜索 + 名人堂 + 阵营快捷）｜中栏画布自适应｜右栏（关系详情 / 共同事件）。
- **交互语义**：
  - 单击相邻人物 → 查看两人关系、共同事件（不切换中心）；
  - 长按约 500ms → 以该人物为中心重布局；
  - 拖拽节点 → 调整布局；画布自动 fit 到全部节点（含 4% 呼吸边距）。
- **分期切换**：21 期细览 + 7 组简阅；切期 / 切模式时中心人物能保留则保留，否则回退该期默认中心。
- **搜索**：本名 / 别名 / 庙号模糊匹配，带同名候选消歧；搜索结果、名人堂、阵营按钮共用「换中心」链路。
- **深链接**：`/graph?person=<person_id>&era=<id>&selected=<person_id>&mode=simple|detail`。

### 6.3 状态与竞态

- 中心切换使用意图令牌 + `AbortController`：只认最后一次意图，旧响应不得回写 UI。
- 受控组件接口：`PersonGraph2D` 支持 `highlightedPersonIds` / `selectedPersonId` / `onPersonSelect`，不传时行为与旧版一致。

### 6.4 验收

见 §12-C。

---

## 7. 模块三：智能历史问答（`/ask`，史令 × 史引）

### 7.1 双人格定位

| 人格 | 职责 |
|---|---|
| **史令** | 严谨的史料答主：调用只读工具检索图谱与史料，按「📜 史料实证 + 💡 史令分析」两节回答；资料不足如实说明 |
| **史引** | 图表的领航员：从回答中派生 UI 动作，自动展开右侧副驾驶分屏展示时间轴 / 人物图，实现问答驱动 UI 联动 |

### 7.2 端到端链路

```
用户提问
  → AgentOrchestrator（规划：纯 JSON 协议，最多 6 个工具轮 / 10 次工具调用）
  → 只读工具层（内存快照；同轮 tool_batch 可并行 2–4 个工具）
  → EvidenceValidator（第一重：证据级校验）
  → FactCheck（第二重：文本级事实核查，不过则退回重写 ≤2 次）
  → AnswerEnvelope（三态回答 + citations / entities / trace / ui_actions）
```

- 非流式入口：`POST /api/agent/ask`；流式入口：`POST /api/agent/chat_stream`（SSE：`start → delta* → done/error`）。
- 服务端预算：`MAX_ITERATIONS=6`、`MAX_TOOL_CALLS=10`、收尾轮 1 次、单条工具结果 ≤10,000 字、
  批量工具结果 ≤16,000 字、注入消息 ≤18,000 字、聊天单条消息 ≤32,000 字、`AGENT_MAX_TOKENS=4096`、温度 0.0。
- 轮次耗尽自动进入「只收尾」轮；仍无合法 final 则按数据实况返回 `insufficient` 或图谱兜底（对比类问题）。

### 7.3 只读工具集（9 个）

`resolve_entity` · `search_events` · `get_event` · `get_person` · `get_person_events` ·
`get_relation` · `get_era_graph` · `timeline_span` · `search_historical_text`

- 工具参数严格（Pydantic `extra="forbid"`、类型严格），未知工具 / 非法参数返回统一失败信封交由模型修正。
- 工具直接读内存快照，不发 HTTP、不写盘；结果信封统一为 `ok / items / citations / truncated / snapshot_version / error`。

### 7.4 双数据源铁律

- 所有历史类提问必须**同时**检索「时间轴·大事记」（`search_events` / `get_event` / `timeline_span`）与
  「人物关系图」（`resolve_entity` / `get_person` / `get_person_events` / `get_relation` / `get_era_graph`）。
- 服务端硬校验双源覆盖：人物 / 关系类问题缺 person / relation 证据、事件类问题缺 event / rag 证据时强制降级；
  `trace.sources` 回填双源覆盖情况。
- 「为什么 / 经过 / 细节 / 评价」等需要长文史料的问题，必须叠加 RAG `search_historical_text` 检索史料原文。

### 7.5 回答三态与正文规范

| 模式 | 触发 | 正文来源 |
|---|---|---|
| `grounded` | 证据可通过双重核查 | 模型 `answer.markdown`（两节结构）或服务端事实实证正文 |
| `insufficient` | 无可核验依据 / 工具结果不覆盖 | **服务端固定模板** + `missing_reasons` |
| `refusal` | 超范围 / 不安全 / 无可靠依据 | **服务端固定文案** + `reason_code` |

- `claims[]` 每条必须绑定 `citation_ids`；`evidence[]` 必须命中本轮工具真实返回的实体。
- 年份冲突标注「史料记载有异」；传说性质内容句首标注 `[传说]`；回答深度随用户身份调整。

### 7.6 防幻觉双重核查

| 层级 | 组件 | 校验内容 | 不通过处理 |
|---|---|---|---|
| 第一重 | `EvidenceValidator` | evidence / citation 是否命中本轮工具真实返回；实体类型 / 来源 / 绑定是否一致；双源覆盖 | 强制降级 `insufficient` / 修复轮 |
| 第二重 | `FactCheck` | 正文中的年份 / 已知人物 / 《书名》/ ≥8 字直接引文是否能在工具结果中核验；两节结构 / 长度 / 控制字符 | 问题清单退回重写（≤2 次）；仍失败回退服务端事实实证正文 |

- 未核验文本永不展示：`trace.fact_check.status ∈ {passed, failed, fallback, server_fallback, skipped}` 随会话持久化。
- 数字类断言不做硬阻断（warning），但会记入 `trace.fact_check.warnings`。

### 7.7 模型与降级

- 任意 **OpenAI 兼容**端点：云端 ModelScope（Qwen3.5）或本机 Ollama（XiaoHong-v1 GGUF）。
- 模型注册表 `GET /api/agent/models` 返回主 / 备模型；`AskRequest.model_id` 支持请求级模型选择。
- 主模型 429 / 502 / 504 / 超时 → 自动切换备用模型重试一次，`trace.model_used` 标明最终模型；
  手动选择模型时另一模型仍作为降级目标（400/404 亦触发切换）。
- 模型未配置 → 503 `LLM_NOT_CONFIGURED`；上游错误 → 502 `LLM_UPSTREAM_ERROR`；超时 → 504 `LLM_TIMEOUT`。
- 本地 Ollama 关键配置：`MODELSCOPE_BASE_URL=http://localhost:11434/v1`、`LLM_REASONING_EFFORT=none`、
  `LLM_TIMEOUT_SECONDS=120`；推荐 `python backend/scripts/test_ollama_stream.py` 做端到端探针。

### 7.8 会话与多轮记忆

- 服务端 `SessionStore`（SQLite，默认 `backend/data/sessions.v1.sqlite`）按 `session_id` 持久化：
  标题 / 置顶 / 轮次（≤200 轮）/ 上一轮实体状态。
- 每轮注入最近 3 轮历史 + 会话实体记忆，让「他们 / 这两人 / 双方」确定性解析为上一轮真实 `person_id`。
- 长对话截断：最近 6 条消息、单条 ≤1,200 字、总 ≤6,000 字；历史中的 assistant 正文先做重复治理再注入。
- 会话 API：`GET/POST /api/sessions`、`GET/PATCH/DELETE /api/sessions/{session_id}`；问答失败不写入会话库。
- 自动化测试会话以 `test_` / `e2e_` 前缀隔离到测试库（`SESSION_TEST_DB_PATH`），不污染正式历史。

### 7.9 UI 联动与动作

- 回答信封携带 `ui_actions[]`（≤3 条），动作类型与可用性见 §3.3 与 `contracts/action-policy.json`。
- 动作必须满足：`target.surface` 与动作类型匹配、payload 字段合法、引用的 ID 在本地数据中存在；
  不合法动作被服务端拒绝或前端忽略。
- 史引副驾驶：`/ask` 左右 Flex 分屏（左对话自适应 / 右副驾驶 40%），支持「人物图谱 / 时间轴」双视图切换；
  `?panel=timeline|graph` 可直接定位。

### 7.10 评测

- `evals/golden.v1.json` 30 条 golden 用例覆盖 12 类（公元前年份 / 同名歧义 / 资料不足 / 跨朝代 / 关系 / 对比 /
  超范围 / 彩蛋排除 / 仅图谱事件 / 多轮 / 事件人物联动 / UI 动作策略）。
- `scripts/run-evals.mjs --mode contract` 离线校验 schema、快照绑定、0 悬空 ID、工具入参与动作策略（含负向自测）。

---

## 8. 安全与红队约束

### 8.1 威胁模型

| 威胁 | 攻击面 | 控制 |
|---|---|---|
| Prompt Injection / 越狱 | 用户提问、历史消息、工具返回文本 | 注入标记中和、Schema 白名单、服务端固定文案、历史 sanitize |
| 伪造证据 / 幻觉 | 模型输出的 evidence / citation / markdown | EvidenceValidator + FactCheck 双重核查，未核验文本不展示 |
| 越权写操作 | `/api` HTTP 方法 | 只读闸门：除问答 / 流式 / 会话管理外，写方法统一 405 |
| 密钥泄漏 | 日志、错误响应、仓库 | `.env` 只本地注入、日志脱敏（`sk-*` / Bearer / `api_key=`，可选 PII）、`.gitignore` 覆盖 |
| UI 动作注入 | 模型生成的 `ui_actions` | 动作类型枚举 + surface 匹配 + payload 校验 + ID 存在性校验 + 上限 3 条 |

### 8.2 红队测试（常驻回归）

- `backend/tests/test_agent_prompt_injection.py`（6 条）：旧协议注入、伪造历史 citation、工具文本注入、越狱正文替换。
- `backend/tests/test_evidence_security.py`（22 条）：证据类型 / 来源 / 绑定、彩蛋不可作证据、UI 动作越权、固定文案。
- `backend/tests/test_factcheck.py`（16 条）：文本核查各字段、越狱标记中和、回退状态。
- 合计 **28 条注入 / 证据安全专项用例**，随全量 pytest 常驻执行。

### 8.3 数据与隐私

- 无账号体系；会话数据仅存本机 SQLite（用户可删除）。
- 本地模型模式下问答数据不出本机；云端模式密钥仅存 `backend/.env` / 系统环境变量，不下发前端、不写日志。
- 分享场景无鉴权：请勿公开暴露到公网，仅通过受控链接发给可信对象。

---

## 9. 全局状态、请求与竞态

- 前端 `AgentContext` 为问答会话唯一事实源；`ActionBus` 负责动作注册 / 分发 / 幂等键 / 待确认队列。
- 所有请求经统一客户端：错误归一化为 `ErrorEnvelope`，`request_id` 贯穿前后端与日志。
- 意图令牌（`request_id`）只用于会产生「用户意图覆盖」的模块（图谱换中心、时间轴定位、重新提问）；
  旧请求返回不得覆盖新意图的 UI 状态。
- SSE 流式回答独立于轮询：连接中断保留已收到文本，用户在会话中可见「生成中断」状态且可重试。

---

## 10. 非功能需求

| 维度 | 要求 |
|---|---|
| 性能 | 首屏静态渲染；图谱 200+ 节点下拖拽 / 布局 60fps 目标；快照 3.47MB 本地加载 |
| 可访问性 | 键盘可达核心功能（图谱 Enter / Space 选中）、ARIA 标签、焦点可见、对比度达标、`prefers-reduced-motion` 生效 |
| 响应式 | ≥1280 最佳；≤1180 侧栏折叠；≤720 窄屏浮层；移动端保证可浏览 |
| 离线 | 时间轴与人物图为纯前端数据，后端离线仍可用；问答如实提示未连接 |
| 隐私 | 无账号；本地模型可完全离线；日志脱敏；`.env` 不入库 |
| 许可 | 页面页脚、引用、README 三处 CC BY-NC-SA 4.0 署名；代码 MIT |
| 错误 | 不出现空白页 / 静默失败；统一错误码与可操作提示（§11） |

---

## 11. 错误与降级矩阵

| 场景 | 状态码 / 错误码 | 用户可见表现 |
|---|---|---|
| 未知实体 / 事件 ID | 404 `ENTITY_NOT_FOUND` | 友好空态 + 提示返回 / 搜索 |
| 非法请求参数 | 400 `INVALID_REQUEST` | 参数错误提示 |
| 写方法（非问答 / 会话） | 405 `METHOD_NOT_ALLOWED` | 只读 API 提示 |
| 未知路由 | 404 `ROUTE_NOT_FOUND` | 404 页面 |
| 快照缺失 / 损坏 | 503 `SNAPSHOT_NOT_LOADED` / `SNAPSHOT_MISMATCH` | 后端拒绝启动，前端提示服务不可用 |
| 模型未配置 | 503 `LLM_NOT_CONFIGURED` | 提示配置 `backend/.env` |
| 模型上游报错 | 502 `LLM_UPSTREAM_ERROR` | 显示可重试错误；先尝试备用模型 |
| 模型超时 | 504 `LLM_TIMEOUT` | 显示可重试错误 |
| 会话不存在 | 404 `SESSION_NOT_FOUND` | 新建会话 |
| 资料不足 | 200 + `mode=insufficient` | 固定文案「抱歉，现有的历史数据无法完整回答您的问题」+ 缺失信息 |
| 超范围 / 不安全 | 200 + `mode=refusal` | 固定文案 + `reason_code` |
| 向量库未构建 | 工具失败信封 | Agent 退回图谱证据或如实说明资料不足 |
| RAG / 图谱均无命中 | `mode=insufficient` | 绝不编造，提示换更具体的人名 / 事件名 |

---

## 12. 验收标准

### A. 公元前年份

1. **GIVEN** 数据含 `-221`，**WHEN** 渲染时间轴 / 人物卡 / 事件卡 / 引用，**THEN** 均显示「公元前221年」，格式由同一函数产出。
2. **GIVEN** 前 1 年与公元 1 年，**WHEN** 计算间隔，**THEN** 结果为 1 年；前 202 → 公元 220 的跨度为 422 年（含端点）。
3. **GIVEN** 年份 `0`，**WHEN** 校验 / 录入，**THEN** 拒绝并给出明确错误。
4. **GIVEN** 跨纪元区间，**WHEN** 展示，**THEN** 形如「公元前1年—公元1年」；同纪元区间形如「公元前221—前207年」。
5. **GIVEN** `circa` 精度的前 2070 年，**WHEN** 展示，**THEN** 显示「约公元前2070年」，排序仍用 `-2070`。

### B. 人物重名与消歧

1. **GIVEN** 同名人物记录（如「梁太后」西夏 / 东汉），**WHEN** 搜索，**THEN** 返回多条候选且各带「时期·身份」副标题，不自动选中。
2. **WHEN** 进入任一人物关系图，**THEN** 邻居只来自该 `person_id`，不出现另一同名者的关系。
3. **WHEN** 问答提到同名人物，**THEN** 实体链接与引用指向被问的那位，展示带消歧括注。
4. **GIVEN** 构建期同名组报告，**THEN** 列出全部同名组供人工裁决，且 CI 不因同名失败。

### C. 时间轴与图谱交互

1. **GIVEN** 简阅模式，**WHEN** 浏览，**THEN** 仅展示 `importance === 3` 事件；切细览展示全部事件。
2. **GIVEN** 朝代 Tab 溢出，**WHEN** 按住拖拽 / 滚轮，**THEN** 可横向滚动且选中项自动居中，不误触切换。
3. **GIVEN** 图谱中心切换在途（模拟 2000ms 延迟），**WHEN** 0/400/800ms 依次点击 A/B/C，**THEN** 最终中心为 C，A/B 响应到达后 UI 无变化。
4. **GIVEN** 深链接 `/graph?person=…&era=…`，**WHEN** 打开，**THEN** 自动选中对应分期与中心；跨期人物优先「关系更完整」的分期。
5. **GIVEN** 问答返回 `timeline.focus_event` / `graph.focus_person`，**WHEN** 用户点击，**THEN** 同页自动执行、跨页确认后跳转，URL 同步。

### D. RAG / 防幻觉 / 注入

1. **GIVEN** 有语料支撑的问题，**WHEN** 回答，**THEN** grounded 且 claims / evidence / citations 全部可回溯到本轮工具返回。
2. **GIVEN** 模型正文含工具结果外年份 / 人物 / 书名 / 引文，**WHEN** 核查，**THEN** 返回重写；连续不过回退服务端正文，未核验文本不外泄。
3. **GIVEN** 问题无可靠来源，**WHEN** 提问，**THEN** 返回 `insufficient` 固定文案，正文不含任何编造年份 / 人名。
4. **GIVEN** 伪造历史 citation 或旧协议注入，**WHEN** 提问，**THEN** 注入字段被 Schema 拒绝、伪造 citation 不进入证据图，最终正文不含注入内容。
5. **GIVEN** 工具文本中包含注入指令，**WHEN** 该结果进入回答，**THEN** 注入标记被中和，正文不包含系统提示词等内容。
6. **GIVEN** 模型输出越权 `ui_actions`（类型 / surface / ID 非法），**WHEN** 下发前端，**THEN** 非法动作被拒绝且不白屏。

### E. 会话与流式

1. **GIVEN** 同一 `session_id` 连续两轮提问，**WHEN** 第二轮提到「他们」，**THEN** 正确解析为上一轮真实人物。
2. **GIVEN** 刷新页面，**WHEN** 重新进入，**THEN** 从服务端会话恢复完整聊天记录（含引用与核查状态）。
3. **GIVEN** 流式回答，**WHEN** 模型输出思考内容，**THEN** 前端只收到最终答案；连接中断保留已生成文本且可重试。
4. **GIVEN** 自动化测试会话（`test_` / `e2e_` 前缀），**WHEN** 写入，**THEN** 只进测试库，正式历史列表零污染。

---

## 13. 版本里程碑

| 里程碑 | 主题 | 状态 |
|---|---|---|
| V0.1 | 全栈骨架 + 种子事件 | ✅ 2026-11-17 |
| V0.2 – V0.4 | 全朝代时间轴（258 条）+ D3 力导向人物图 | ✅ 2026-11-18 |
| V0.5 – V0.6 | 图谱分期 / 三栏导航 / 简阅·细览 / 三国两晋南北朝数据 | ✅ 2026-11-19 → 20 |
| V0.7 – V0.8 | 全朝代数据灌入与厚度对齐 + 全量校验脚本 | ✅ 2026-11-20 → 21 |
| V0.9 | 内测封装：同源代理 / CORS / 局域网与 UUMit 分享 | ✅ 2026-11-21 |
| V1.0.1 – V1.0.3 | 契约冻结 · 8 个只读工具 · Agent Core 与防幻觉底座 | ✅ 2026-11-23 |
| V1.0.4 – V1.0.5 | Agent → UI 动作联动 · RAG 混合检索 · 自动降级 | ✅ 2026-11-24 |
| V1.0.5.1 – V1.0.5.4 | 对比任务 · 对话工作区 · 双数据源 · 全自动数据入库 | ✅ 2026-11-24 → 25 |
| V1.0.6 – V1.0.6.3 | 多轮记忆 · 双重事实核查 · 本地 Ollama 流式 · 双图联动 | ✅ 2026-11-25 → 26 |
| **V1.0.7** | **终极发版：全量体检、文档重构、版本统一、开源发布准备** | 🚀 当前版本 |
| V1.1 | 3D 星图 + 时光机滑块（终极视觉重构） | 🔮 规划中 |

---

## 14. ADR 决策记录（V1.0 实现基线）

| # | 决策 | 结论 | 理由 |
|---|---|---|---|
| 1 | 公元前年份存储 | 有符号整数、无公元 0 年 | 排序天然正确；跨纪元运算用天文纪年修正 |
| 2 | 时间轴刻度 | 朝代块等宽为主 | 兼顾点击可达性与时间可读性 |
| 3 | 人物身份 | 稳定 `person_id` + 副标题消歧 | 关系与引用不串人 |
| 4 | 关系图维度 | **V1.0 用 D3 2D 力导向，3D 推迟到 V1.1** | 成本 / 性能 / 可访问性可控；2D 已满足探索需求 |
| 5 | 数据获取 | 构建期确定性快照，不做运行时爬取 | 可复现、可校验、离线可用 |
| 6 | 数据来源 | shiji-kb + 正史人工校订，非商业许可 | 开放许可、可溯源；《史记》原文公有领域 |
| 7 | 回答三态 | `grounded / insufficient / refusal` | 不编造，且不把功能做死 |
| 8 | 正文生成 | 模型生成 + 服务端双重核查（V1.0.6.1 起） | 兼顾可读性与可核验性；不通过回退服务端实证 |
| 9 | 证据链 | evidence / citation 必须命中本轮工具真实返回 | 防伪造引用与跨实体引用 |
| 10 | 双数据源 | 时间轴 + 人物图必须同时检索并硬校验 | 与产品「两个数据源」定位一致，防单源臆断 |
| 11 | 模型接入 | OpenAI 兼容端点，云端 / 本地 Ollama 可切换 | 支持本地隐私部署与云端高可用降级 |
| 12 | RAG 向量库 | chromadb 0.4.24 + fastembed bge-small-zh-v1.5 | Windows 兼容（1.5.9 触发 SQLite code 14）+ 无 torch 依赖 |
| 13 | 会话存储 | SQLite（服务端权威） | 多轮记忆跨刷新可用，可测试隔离、可清理 |
| 14 | 契约管理 | Pydantic 唯一事实源 + 生成物冻结 + 只增不破 | 前后端类型一致；破坏性变更显式升版本 |
| 15 | 质量门禁 | `scripts/verify.ps1` 12 步 + CI 复刻 | 单一权威门禁，发版可重复验证 |

---

## 15. 已知限制与后续方向

- 人物关系图为**一度关系视图**，不做多跳裁剪；图谱节点尚未与 `person_id` 统一命名空间（V1.1）。
- 两人关系定性为人工裁断，部分分期（春秋 / 战国 / 部分秦汉、宋元明清）尚无关系徽章，面板回退事件正文。
- 34 条图谱补足事件只进人物图、不进时间轴；时间轴为精选数据而非穷举。
- 关系抽取、自动史实审核、移动端完整交互均非 V1.0 目标。
- RAG 覆盖范围决定对比 / 评价类问题深度：语料未覆盖时按规则标注缺失或降级，不编造。
- V1.1 计划：3D 星图、时光机滑块、图谱节点与 `person_id` 统一、多跳关系裁剪、移动端手势优化。

---

## 16. 术语表

| 术语 | 含义 |
|---|---|
| YearValue | `{ year, precision, note? }`，`year ≠ 0` |
| 天文纪年 A(y) | 运算用纪年（含 0 年），仅内部使用 |
| 断代 / scope | 7 大历史分段（先秦 / 秦汉 / 三国 / 魏晋南北朝 / 隋唐 / 五代辽宋夏金 / 元明清） |
| 细览 / 简阅 | 人物图的两种粒度：21 期细览 + 7 组简阅；时间轴对应全部事件 / importance 3 |
| 快照（Snapshot） | 构建期生成的只读 JSON 数据包，内容寻址（sha256） |
| 锁文件（locks） | 冻结人物 / 事件 ID 与全量计数的生成物，防漂移 |
| Chunk | RAG 检索与引用的最小文本单元（≤500 字） |
| Claim | 回答中的事实陈述，必须绑定 citation |
| Evidence | 本轮工具真实返回的实体证据，供 EvidenceValidator 校验 |
| FactCheck | 第二重文本级事实核查（年份 / 人物 / 书名 / 引文） |
| tool_batch | 同轮并行执行多个只读工具的内部协议动作 |
| 史令 / 史引 | 问答双人格：史令负责严谨作答，史引负责图表联动 |
| UI Action | 回答携带的界面联动动作（`timeline.focus_event` 等） |
| ActionBus | 前端动作注册 / 分发 / 待确认队列 |
| `snapshot_version` | 快照版本号（`v1-<hash>`），贯穿 API 响应与会话记录 |