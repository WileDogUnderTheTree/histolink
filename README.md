<div align="center">

# 史脉 HistoLink

**中国历史探索 · 以结构化数据为核心的可视化历史探索 Web 应用**

当前版本 **V1.0.5.1（Agent 对比任务优化 + 对话工作区 UI 重构补丁）**；**V1.0.2 工具层已发布**（tag `v1.0.2`；8 个只读工具 + 统一信封契约 + 62 条单测）；**V1.0.3 Agent Core 已发布**（规划器 / 执行器 / 证据校验与安全加固）；**V1.0.4 UI 联动已完成**（AgentContext / ActionBus、史令 / 史引双人格、抽屉与 `/ask` 共享会话、同页自动 / 跨页确认与 URL 深链接闭环）；**V1.0.5 已完成 RAG 混合检索 + LLM 自动降级**（51 篇语料 → 186 条 chunk 本地向量库 + 第 9 个工具 `search_historical_text` + 图谱/RAG 分节回答与冲突标注；主模型 429/502/504/超时自动切换备用轻量模型并回填 `trace.model_used`）；**V1.0.5.1 已完成对比任务优化与对话工作区重构**（内部 `tool_batch` 并行只读工具 + 对比 Prompt 三阶段策略 + 有界收尾轮 / 校验修复轮；`/ask` 改为单一滚动的对话时间线 + 底部输入区，修复长回答裁切与「返回聊天」丢问题；后端全量 **318 条测试通过**，前端无头验收 **39/39**） ｜ 数据快照 **705 条事件（时间轴 671 + 图谱补足 34）· 23 个朝代/时期 · 1,058 人物 · 639 对人物关系 · 18 期 / 7 组人物关系图数据**

</div>

---

## 一、项目简介

**史脉（HistoLink）** 是一个面向中文用户的中国历史探索 Web 应用。它以**结构化数据**为主干——用时间轴纵览朝代大事、用人物关系图探索历史人物网络；以**语义 RAG** 为辅——仅用于后续 Agent 问答环节，并保证每个答案可回溯到可核验的史料出处。

产品围绕三个原则设计：

- **结构化数据优先**：时间轴事件、人物关系网均为人工校订的结构化数据，而非检索式的文本拼贴；页面渲染完全由数据驱动。
- **可核验**：每条事件描述均保留出处括注（如「据《史记·周本纪》」），人物关系由事件的 `participants` 自动推导，关系可解释。
- **渐进演进**：V0.x 阶段专注于时间轴与 2D 人物关系图的深度扩充，只做数据层加法，不重写底层组件；Agent 与 RAG 在 V1.0 接入，终极 UI（3D 视图、滑块交互）在 V1.1 重构。

> 需求与验收标准的唯一来源是 [SPEC.md](SPEC.md)；版本演进记录见 [CHANGELOG.md](CHANGELOG.md)。

### 已实现功能

| 模块 | 路由 | 说明 |
|---|---|---|
| 首页 | `/` | 模块入口导航；「聊天问答」入口已开放（V1.0.4 起直达 `/ask` 并共享同一会话），时间轴 / 人物关系图入口正常；实时检测后端连通状态（右下角状态点） |
| 全朝代时间轴 | `/timeline` | 夏—清共 **670 条**精选事件；「简阅 / 细览」双视图——细览按 23 个朝代/时期、简阅按 7 大断代（先秦 / 秦汉 / 三国 / 魏晋南北朝 / 隋唐 / 五代辽宋夏金 / 元明清）只看顶级事件；Tab 多时横向滑动、隐藏滚动条，支持鼠标按住拖拽与惯性滑行，箭头位于容器外侧不遮挡 Tab；圆点按年份自动上下错层、密集时自动缩小 |
| 2D 人物关系图 | `/graph` | 「简阅 / 细览」双视图：细览 **18 期**（春秋 / 战国 / 秦汉 / 三国 / 西晋 / 东晋十六国 / 南北朝 / 隋 / 唐 / 五代十国 / 北宋 / 南宋 / 辽 / 西夏 / 金 / 元 / 明 / 清），简阅 **7 组**（先秦 / 秦汉 / 三国 / 魏晋南北朝 / 隋唐 / 宋辽金夏 / 元明清）；D3 力导向 + SVG；单击相邻人物查看两人关系、共同事件与事件简述，长按约 500ms 切换中心，拖拽调整位置；切期 / 切模式时中心人物能保留则保留 |
| 图谱三栏导航 | `/graph` | 左栏 240px（人物搜索 + 名人堂 + 三国阵营快捷）｜中栏画布自适应｜右栏 280px 关系详情；搜索、名人堂与阵营按钮均可直达任意人物为中心；支持本名 / 庙号别名搜索（如「拓跋宏」→ 孝文帝、「清圣祖」→ 康熙帝）；图区上方仅保留一行操作副标题 + `?` 气泡，复杂说明不占正文 |
| 后端服务 | `GET /api/health` | FastAPI 健康检查；CORS 默认放行本机与局域网私有网段，可用 `ALLOW_ORIGINS` / `ALLOW_ORIGIN_REGEX` 覆盖；前端默认经 Next 同源 `/api` 代理访问 |
| 问答壳层（V1.0.1 骨架 → V1.0.4 数据层） | `/ask` + 全局抽屉 | `AgentContext` 单一会话：页面右下角「问史脉」悬浮抽屉与 `/ask` 共享同一份 transcript；V1.0.4 已接入真实 `POST /api/agent/ask`（页面上下文 + history），同页动作自动执行、跨页动作弹确认后跳转；`/ask` 在回答带 `timeline.focus_event` / `graph.focus_person` 等动作时**自动展开右侧史引副驾驶面板** |
| 组件受控与深链接（V1.0.1） | `/timeline` · `/graph` | `PersonGraph2D` 新增可选 `highlightedPersonIds` / `selectedPersonId` / `onPersonSelect`（不传时行为与 V0.9.0 完全一致）；ActionBus 在时间轴 / 图谱页注册同页动作并回写 URL；支持 `/timeline?event=…`、`/graph?person=…&era=…&selected=…` 直接恢复视图（含受控关系面板） |
| 评测骨架（V1.0.1） | `evals/` + `scripts/run-evals.mjs` | 30 条 golden 用例覆盖 12 类（公元前年份 / 同名歧义 / 资料不足 / 跨朝代 / 关系 / 对比 / 超范围 / 彩蛋排除 / 仅图谱事件 / 多轮 / 事件人物联动 / UI 动作策略）；contract 模式离线校验 schema、快照绑定、0 悬空 ID、工具入参与动作策略，含负向自测 |
| 模型连通性（V1.0.1 / TC-10） | `/api/agent/ping_llm` | 实测 `Qwen/Qwen3.5-35B-A3B`：连通性 / JSON 模式 / tool calling / SSE / 中文回答均通过；默认思考模式延迟高，已给出 V1.0.3 参数与降级路线 |
| Agent 问答（V1.0.3） | `POST /api/agent/ask` | 规划器 + 工具循环（V1.0.5.1 起最多 6 个工具轮，支持 `tool_batch` 并行 2–4 个只读工具 + 轮次耗尽后至多 2 次「只收尾」调用）+ 证据校验；Qwen `enable_thinking=false` + JSON 模式；evidence / citation 对不上工具真实结果时强制降级 `insufficient`；主模型 429/502/504/超时自动切换备用轻量模型并在 `trace.model_used` 标明最终模型；返回冻结 `AnswerEnvelope`（含 citations / entities / trace） |
| Agent UI 数据层（V1.0.4） | `frontend/contexts/AgentContext.tsx` | 全局 Agent 状态：提问 → 组装页面上下文 / history → 调用 `/api/agent/ask` → transcript；ActionBus 按 `target.surface` 判定同页自动执行 / 跨页确认；确认后按动作生成深链接导航（Timeline / Graph 已注册 `timeline.focus_event`、`graph.focus_person` 等 handler）；`lib/agent-guide.ts` 从回答派生 `guide`，`/ask` 据此自动展开史引副驾驶并渲染对应组件 |
| 人物主数据（V1.0.1） | `frontend/data/persons.ts` | 1,058 条 person 记录 = 1,059 个姓名 − 3 条异名同一人合并 + 2 条同名拆分（梁太后 / 刘崇）；稳定 `person_id` + ID 锁文件 + 66 条全局别名 + 同名报告 + `--check` 门禁 |
| 数据快照与只读 API（V1.0.1） | `backend/data/` · `/api/meta` · `/api/entities/*` | 前后端同源快照（705 事件 / 1,058 人物 / 639 关系 / 18 期 / 7 断代，约 2.7MB，内容寻址 hash）；FastAPI 启动校验快照，提供 meta / person / event / 姓名候选只读接口与统一错误 envelope |
| 只读工具层（V1.0.2） | `backend/agent/tools/` | 8 个只读工具（实体消歧 / 事件检索 / 事件 / 人物 / 人物事件 / 关系 / 时期图谱 / 时间区间）直接读内存快照；统一信封 `ok/items/citations/truncated/snapshot_version/data/error/meta` 已写入 `tools-v1.schema.json` 的 `output`；62 条单测覆盖正常 / 空结果 / 歧义 / 非法参数 |
| RAG 史料检索（V1.0.5） | `backend/rag/` · `backend/scripts/ingest_rag.py` · `search_historical_text` | 51 篇 WorkBuddy 语料 → 186 条 ≤500 字 chunk 的本地 chromadb 向量库（ModelScope API 未开放 embedding 时自动降级本地 fastembed `bge-small-zh-v1.5`，manifest 记录 provider）；第 9 个只读工具 `search_historical_text(query, top_k≤3)` 单次最多 3 条 × 每条 ≤300 字；Agent 混合路由按 ① 图谱基础事实 / ② RAG 史料细节分节回答，年份冲突标注「史料记载有异」，传说句首 `[传说]`，双空则 `insufficient` |
| LLM 自动降级（V1.0.5） | `backend/llm_client.py` · `trace.model_used` | 主模型 `MODELSCOPE_MODEL`（35B）遇到 HTTP 429 限流 / 502、504 网关错误 / 超时 → warning 日志 + 自动切换 `MODELSCOPE_FALLBACK_MODEL`（默认 `Qwen/Qwen3.5-8B-Instruct`）重试一次；备用也失败才返回 `LLM_UPSTREAM_ERROR` / `LLM_TIMEOUT`；`trace.model_used` 标明最终完成回答的模型，前端在非 35B 时于回答下方追加灰字提示 |

### 规划中（尚未实现）

| 模块 | 计划版本 | 说明 |
|---|---|---|
| 已融合至图谱与搜索框 | V0.5 阶段完成 | 放弃了独立 `/people` 页面，将首字母与搜索能力深度整合进了 PersonGraph2D 左侧面板的‘名人堂’。 |
| 核心链路已完成 | V1.0.1 - V1.0.5.1 | 包含 DSH 路由、工具链、防幻觉证据校验、ActionBus 分屏联动、ChromaDB RAG 混合检索、对比任务并行工具与对话工作区。 |
| 3D 人物关系视图、时间轴滑块交互 | V1.1.0 (待宣发后启动) | 终极 UI 重构。为控制开发成本与 Token 消耗，当前阶段保留 2D 版本。待项目正式发布并完成宣传片制作后，再启动 3D 力导向图与滑块交互重构。 |
| 时间轴尽头彩蛋节点（1893-12-26） | 已完成 (V0.8.2.2) | 已在历史长河尽头点亮红星，点击可弹出教员诗词的庄重横幅。 |

---

## 二、技术栈

| 层级 | 技术 | 版本 / 说明 |
|---|---|---|
| 前端框架 | [Next.js](https://nextjs.org/)（App Router） | 16.4.6 |
| UI 运行时 | React / React DOM | 19.3.1 |
| 语言 | TypeScript | 5.9（`strict` 模式，构建前全量类型检查） |
| 力导向可视化 | [d3-force](https://github.com/d3/d3-force) + [d3-selection](https://github.com/d3/d3-selection) | 3.0.1 / 3.0.1，SVG 渲染 |
| 样式 | CSS Modules + 全局 CSS 变量 | 无 UI 框架依赖，无 Tailwind |
| 包管理与构建 | pnpm + Next.js Turbopack | 锁文件 `frontend/pnpm-lock.yaml` |
| 后端 | [FastAPI](https://fastapi.tiangolo.com/) + Uvicorn + Pydantic v2 | `fastapi>=0.115`、`uvicorn[standard]>=0.34`、`pydantic>=2.9,<3`（Python 3.11 虚拟环境） |
| 契约与门禁 | Pydantic → OpenAPI 3.1 → `openapi-typescript` | 后端 `backend/contracts` 为唯一事实源；三份契约 + 动作策略 + 32 条后端契约测试 |
| 测试 | pytest / vitest / evals | 后端 269 条（契约 + 只读 API + 工具层 + Agent Core + 安全加固 + LLM 客户端 + fail-fast）；前端 110 条（动作策略 / ActionBus / 深链接 / 受控选中 / 能力映射 / Agent 数据层 / 动作导航 / 史引联动派发）；评测 30 条 golden（contract 模式） |
| 运行形态 | 前后端分离 | 前端渲染与交互；后端为只读数据服务（快照 + `/api/entities/*`），不接数据库、无写接口 |

浏览器支持：桌面 Chrome / Edge 最近两个大版本，Safari 16+ 可浏览；桌面优先，移动端保证可浏览与降级。

---

## 三、目录结构

```text
史脉/
├─ frontend/                        Next.js 前端（端口 3000）
│  ├─ app/
│  │  ├─ page.tsx                   首页：模块入口 + 后端连通状态
│  │  ├─ timeline/page.tsx          全朝代时间轴（错层布局算法在页面内）
│  │  ├─ graph/                     人物关系图页面（三栏布局 + 搜索/名人堂）
│  │  ├─ ask/page.tsx               V1.0.1 /ask 独立问答页（与抽屉共享会话）
│  │  └─ globals.css                全局样式与配色变量
│  ├─ components/
│  │  ├─ PersonGraph2D.tsx          D3 力导向图组件（交互逻辑与页面解耦）
│  │  ├─ ScrollableTabs.tsx         时间轴 / 图谱共用的横向滑动 Tab 栏
│  │  ├─ ViewModeSwitch.tsx         时间轴 / 图谱共用的「简阅 · 细览」开关
│  │  └─ agent/                     AgentProvider（单一会话）+ AgentDrawer（悬浮抽屉）
│  ├─ data/
│  │  ├─ timeline-events.ts         事件主数据（TimelineEvent[]，共 671 条）
│  │  ├─ timeline-participants.ts   事件参与者索引（人物关系网的数据源）
│  │  ├─ person-graph.ts            事件 → 节点/边转换、分期配置、名人堂与阵营配置
│  │  ├─ person-relations.ts        两人关系数据（关系定性 + 逐事件简述，按分期补丁）
│  │  ├─ weijin-events.ts           魏晋图谱补足事件（只进人物图）
│  │  ├─ persons.generated.ts       V1.0.1 生成的人物主数据（禁止手改）
│  │  ├─ person-overrides.ts        V1.0.1 同名裁决层（唯一允许手改的人物数据）
│  │  ├─ persons.ts / person-aliases.ts / person-types.ts   人物读取入口与类型
│  │  ├─ event-sources.ts           结构化引用索引（禁止手改）
│  │  └─ locks/                     person-ids / event-ids 锁文件
│  ├─ lib/                          year.ts / api-types.ts（生成）/ action-bus.ts /
│  │                                action-policy.ts / action-capabilities.ts /
│  │                                graph-selection.ts / deep-links.ts / routes.ts
│  └─ tests/                        vitest 单测（动作策略 / ActionBus / 深链接 /
│                                   受控选中 / 能力映射）
├─ evals/                           30 条 golden 用例 + schema + 评分说明（TC-09）
├─ backend/                         FastAPI 只读服务（端口 8000）
│  ├─ main.py                       create_app() + lifespan 加载快照 + CORS + 只读闸门
│  ├─ llm_client.py                 ModelScope / OpenAI 兼容最小客户端（TC-10）
│  ├─ snapshot_store.py             快照加载 / 校验 / 只读查询
│  ├─ agent/                         V1.0.3 Agent Core
│  │  ├─ schemas.py                 ToolCall / Evidence / FinalAnswer / AgentResult
│  │  ├─ prompts.py                 System Prompt（纯 JSON 协议 + 三态 + 禁止幻觉）
│  │  ├─ tool_registry.py           工具白名单 + 严格 Pydantic 参数校验
│  │  ├─ orchestrator.py            规划 / 执行 / 回传循环（最多 4 轮）
│  │  ├─ validator.py               EvidenceValidator（证据不可核验 → insufficient）
│  │  └─ tools/                     V1.0.2 只读工具层（8 工具 + ToolContext + 统一信封）
│  ├─ contracts/                    API / Action / Tool 契约的 Pydantic 事实源
│  ├─ routers/                      health / meta / entities / agent（ping + ask）
│  ├─ errors.py                     统一错误 envelope 与 /api 只读闸门
│  ├─ data/                         snapshot.v1.json + snapshot.meta.json（生成物）
│  ├─ tests/                        pytest（契约 / 只读 API / 工具层 / Agent Core / LLM / fail-fast）
│  └─ scripts/                      export_contracts.py / spike_llm.py
├─ contracts/                       三份契约导出物 + action-policy + samples + README
├─ scripts/
│  ├─ launch.ps1 / stop.ps1         一键启动与按端口停止
│  ├─ verify.ps1                    本地权威门禁（tsc/build/校验/契约/快照/pytest/vitest/evals）
│  ├─ build-persons.mjs             人物主数据生成（--check）
│  ├─ extract-sources.mjs           引用结构化生成（--check）
│  ├─ export-snapshot.mjs           数据快照导出（--check）
│  ├─ gen-frontend-types.mjs        OpenAPI → 前端类型（--check）
│  ├─ validate-contract.mjs         契约测试（Node 侧）
│  ├─ run-evals.mjs                 评测运行器（--mode contract / live）
│  ├─ validate-data.mjs             全量数据 + 人物主数据 + 引用 + 快照一致性校验
│  └─ lib/                          共享 TS 数据加载器 / 引用解析器
├─ .github/workflows/ci.yml         CI（前端 + 后端 + 评测）
├─ docs/                            需求审核报告、任务卡、验收记录、数据文档、spike 报告
├─ 启动史脉.cmd / 停止史脉.cmd       Windows 双击入口
├─ SPEC.md                          需求与验收标准（唯一需求来源）
├─ CHANGELOG.md                     版本更新日志
└─ README.md
```

---

## 四、快速开始

### 4.1 环境要求

| 依赖 | 要求 | 说明 |
|---|---|---|
| Node.js | **≥ 20.9.0** | Next.js 16 的引擎要求 |
| pnpm | 任意近期版本 | 前端包管理器（首次 `pnpm install`） |
| Python | **≥ 3.11** | 后端运行于项目内 `.venv` 虚拟环境 |
| 操作系统 | Windows 10/11 | 一键启动器为 PowerShell 实现；其他系统可按「手动启动」运行 |

启动器会自动寻找 Node / pnpm（优先 `PATH`，找不到时回退到本机内置运行时），因此即使 Node 未加入 `PATH` 也能启动。

### 4.2 一键启动（推荐）

**双击 `启动史脉.cmd`**，启动器会：

1. 检查 Python 虚拟环境与后端依赖、Node/pnpm 与前端依赖（缺失时提示自动安装）；
2. 启动 FastAPI（<http://127.0.0.1:8000>）与 Next.js（<http://localhost:3000>）；
3. 两个服务就绪后自动打开浏览器，并在同一窗口以 `[后端]` / `[前端]` 前缀实时显示日志；
4. 按 `Ctrl+C` 或关闭该窗口即可停止本次启动的全部服务。

**停止服务**：双击 `停止史脉.cmd`（只会结束属于本项目的 3000 / 8000 端口进程，不会误杀其他程序）。

启动器参数（命令行中使用）：

| 参数 | 说明 |
|---|---|
| `-NoBrowser` | 不自动打开浏览器 |
| `-Restart` | 端口被占用时强制结束占用进程后重启 |
| `-NoPause` | 出错时不等待回车（供脚本 / 自动化调用） |

运行日志写入 `.run\`：`backend.out.log`、`backend.err.log`、`frontend.out.log`、`frontend.err.log`，启动器窗口内同步显示。

### 4.3 手动启动

```powershell
# 后端（FastAPI，端口 8000）
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload --port 8000

# 前端（Next.js，端口 3000）——另开一个终端
cd frontend
pnpm install   # 首次
pnpm dev
```

打开 <http://localhost:3000>：右下角显示「后端已连接」即前后端联通正常。

> V0.9.0 起前端健康检查走同源 `/api`（`next.config.ts` 把它代理到 `http://127.0.0.1:8000`），因此分享给他人时只需暴露前端 3000 端口，详见 §4.7「分享给局域网 / 公网测试」。

### 4.4 生产构建

```powershell
cd frontend
pnpm build     # Next.js 生产构建（含全量 TypeScript 类型检查）
pnpm start     # 以生产模式启动，端口 3000
```

### 4.5 数据校验（V0.8.2 起）

```powershell
# 在仓库根目录执行：事件 / 图谱 / 关系 / 别名 / 名人堂 / docs 六层校验
node scripts/validate-data.mjs
```

脚本用 TypeScript 编译器加载 `frontend/data` 下的数据模块，检查事件字段与 id 唯一性、时间轴与 `EVENT_PARTICIPANTS` 双向一致、18 期 + 7 组图谱的默认中心 / 节点 / 边 / 权重 / 双向一致性（0 孤儿节点、0 悬空边）、**图谱分期隔离（节点须锚定当期声明朝代；秦汉 184 / 三国 188 年分界；默认中心须在名人堂池内）**、关系库 pairKey 与共同事件、别名与名人堂目标、docs 数据文件完整性；失败时以非 0 退出码结束。正常输出以 `✓ ALL CHECKS PASSED` 收尾，并打印分朝事件数与分图表节点 / 边统计。

### 4.5.1 一键门禁（V1.0.1 起）

本地权威质量门禁是 `scripts/verify.ps1`（CI 的 `.github/workflows/ci.yml` 复刻同一组检查）。它按顺序执行 **12 步**：类型检查、生产构建、数据校验、`build-persons` / `extract-sources` / `export_contracts` / `gen-frontend-types` / `export-snapshot` 五个 `--check`、后端 `pytest`、前端 `vitest`、评测 `run-evals --mode contract`、契约测试 `validate-contract`，任一项失败即非 0 退出：

```powershell
# 在仓库根目录执行（Windows PowerShell 默认禁止未签名脚本，需 Bypass）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1

# 快速回归：跳过较慢的 next build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -SkipBuild

# 只跑指定步骤（编号见脚本头注释）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -Only 1,3
```

脚本优先使用 PATH 上的 Node / pnpm / Python，找不到时自动回退到 DSH 内置运行时（与 `scripts/launch.ps1` 同一套解析策略）。

### 4.6 常用地址与端点

| 项 | 地址 / 端点 | 说明 |
|---|---|---|
| 首页 | <http://localhost:3000> | 模块入口与后端连通状态 |
| 时间轴 | <http://localhost:3000/timeline> | 全朝代事件时间轴 |
| 人物关系图 | <http://localhost:3000/graph> | 三栏布局，分期可切换 |
| 健康检查 | `GET http://127.0.0.1:8000/api/health` | 响应 `{"ok": true, "version": "1.0.5.1"}`；也可经前端同源访问 `GET http://localhost:3000/api/health` |

V1.0.1 起后端是**只读数据服务**；V1.0.3 新增唯一写入口 `POST /api/agent/ask`（问答），其余 `/api` 写方法仍返回 405。全部接口如下（响应均带 `schema_version` 与 `snapshot.version/hash`）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 版本与存活检查 |
| GET | `/api/meta` | 快照版本 / counts / 能力清单（5 个可用动作 + clarification） |
| GET | `/api/entities/person/{person_id}` | 人物主数据 + 别名 + 分期/断代 + 事件摘要（上限 50） |
| GET | `/api/entities/event/{event_id}` | 事件 + `person_ids` + 结构化 `source_refs` + `surface` |
| GET | `/api/entities/persons?name=&era_id=&limit=` | 姓名候选（同名时返回多条，带消歧副标题） |
| GET | `/api/agent/ping_llm?message=请回复 OK` | **TC-10 连通性探测**：向模型发一句测试话，返回真实回复 / 模型名 / 耗时（需要配置 `backend/.env`） |
| POST | `/api/agent/ask` | **V1.0.3 问答**：规划 → 工具 → 证据校验 → `AnswerEnvelope`；模型未配置 503 / 超时 504 / 上游错误 502 |

```powershell
curl http://127.0.0.1:8000/api/meta
curl http://127.0.0.1:8000/api/entities/person/p-liangtaihou-xixia-0d0f
curl "http://127.0.0.1:8000/api/entities/persons?name=梁太后"          # 2 个候选
curl "http://127.0.0.1:8000/api/entities/persons?name=梁太后&era_id=xixia"  # 1 个候选
curl http://127.0.0.1:8000/api/agent/ping_llm                         # 模型连通性（需 .env）

# V1.0.3 问答（PowerShell；中文请求体需按 UTF-8 字节发送）
$body = @{
  question   = "赤壁之战发生在哪一年？"
  session_id = "demo-1"
  context    = @{ route = "/timeline" }
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/agent/ask" -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) | ConvertTo-Json -Depth 12
```

错误统一为 `{"ok": false, "request_id": "...", "error": {"code", "message", "retryable", "details?"}}`：
未知 id → 404 `ENTITY_NOT_FOUND`；写方法（除 `/api/agent/ask`）→ 405 `METHOD_NOT_ALLOWED`；非法参数 → 400 `INVALID_REQUEST`；
快照未加载 → 503 `SNAPSHOT_NOT_LOADED`；模型未配置 → 503 `LLM_NOT_CONFIGURED`；
上游报错 → 502 `LLM_UPSTREAM_ERROR`；模型超时 → 504 `LLM_TIMEOUT`（主模型 429 / 502 / 504 / 超时会先自动降级到备用轻量模型重试一次，仍失败才返回）。
后端启动时校验快照 hash/counts，失败即拒绝启动。

前端默认经 Next 同源代理访问后端（`/api/*` → `API_PROXY_TARGET`，默认 `http://127.0.0.1:8000`），浏览器侧不产生跨域。

后端直连时的 CORS 默认放行 `http://localhost:3000`、`http://127.0.0.1:3000`，以及任意局域网私有网段（`10.x` / `192.168.x` / `172.16–31.x`，任意端口）；可用 `ALLOW_ORIGINS` / `ALLOW_ORIGIN_REGEX` 覆盖。朋友 IP 不同**无需改代码**。

### 4.6.1 配置模型（V1.0.1 / TC-10 连通性）

模型凭据只经 `backend/.env`（或同名环境变量）注入，**不入库、不写日志**：

```powershell
# 1) 复制模板并填入真实 key
Copy-Item backend\.env.example backend\.env
# 编辑 backend\.env：
#   MODELSCOPE_API_KEY=你的 key
#   MODELSCOPE_BASE_URL=https://api-inference.modelscope.cn/v1
#   MODELSCOPE_MODEL=Qwen/Qwen3.5-35B-A3B
#   MODELSCOPE_FALLBACK_MODEL=Qwen/Qwen3.5-8B-Instruct   # 高可用：429/502/504/超时自动降级

# 2) 不启动服务，先跑独立探针（推荐，最快验证 key / URL / 模型名）
cd backend
.\.venv\Scripts\python scripts\spike_llm.py

# 3) 起服务后用接口 / Postman 验证（GET，无请求体）
cd backend
.\.venv\Scripts\python -m uvicorn main:app --reload --port 8000
curl http://127.0.0.1:8000/api/agent/ping_llm
# 也可自定义测试语句：curl "http://127.0.0.1:8000/api/agent/ping_llm?message=请回复OK"
```

响应示例：`{"ok":true,"message":"请回复 OK","reply":"OK","model":"Qwen/Qwen3.5-35B-A3B","latency_ms":2441,"usage":{"prompt_tokens":13,"completion_tokens":162,"total_tokens":175}}`。
> TC-10 实测要点：模型**默认开启思考**，`max_tokens` 不限制 reasoning tokens；默认模式单次 ping 174–251 tokens，
> 关闭思考后仅 16 tokens。V1.0.3 规划器将显式 `enable_thinking=false`，详见 [能力报告](docs/spikes/modelscope-qwen3.5-35b-a3b-capability.md)。
可用 `ENABLE_LLM_PROBE=0` 关闭该探测端点（公网分享前端时建议关闭，避免他人消耗模型额度）。
更多探针清单见 [docs/spikes/README.md](docs/spikes/README.md)。

### 4.7 分享给局域网 / 公网测试（V0.9.0 内测）

> V0.9.0 的内测封装目标：让没有开发环境的朋友也能直接打开时间轴与人物关系图。
> 前端默认走同源 `/api` 代理，**分享时只需要让别人访问前端 3000 端口**，后端 8000 保持本机监听即可，CORS 基本不会成为障碍。

#### 方式 A：局域网（同一 Wi-Fi，最快）

1. 本机正常启动前后端（`启动史脉.cmd`，或手动 `uvicorn` + `pnpm dev`）；
2. 查本机局域网 IP：`ipconfig`，记下「IPv4 地址」（如 `192.168.1.23`）；
3. 让朋友在同一 Wi-Fi 下打开 `http://192.168.1.23:3000`；
4. 首次访问若被 Windows 防火墙拦截，以管理员身份放行 3000 端口：

```powershell
New-NetFirewallRule -DisplayName "史脉内测 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
```

注意：

- Next.js 16 的 `dev` / `start` 默认已监听 `0.0.0.0`；要显式指定用 `pnpm dev:lan`（等价 `next dev -H 0.0.0.0 -p 3000`）。
- **`pnpm dev --host` 不是有效参数**（Next 16 会报 `unknown option '--host'`），正确写法是 `-H 0.0.0.0`，或直接用 `pnpm dev:lan` / `pnpm start:lan`。
- 若使用 **dev 模式**分享：V0.9.0 起 `next.config.ts` 会自动把本机全部局域网 IPv4 与 UUMit 隧道域名（`**.uua2a.com` / `**.uumit.com`）加入 `allowedDevOrigins`，局域网与 UUMit dev 分享**零配置**即可正常水合；隧道域名有变化时用 `ALLOWED_DEV_ORIGINS` 追加（如 `$env:ALLOWED_DEV_ORIGINS="app-3000--xxx.uua2a.com"`）。**生产模式（`pnpm build` + `pnpm start:lan`）不受此限制，分享时更推荐。**
- 后端**不需要**改成 `--host 0.0.0.0`；如果确实要让浏览器直连后端，才需 `uvicorn main:app --host 0.0.0.0 --port 8000` 并调整 CORS（见下文）。
- 电脑休眠 / 切换网络会导致访问中断；测试期间保持电脑唤醒，防火墙放行「专用网络」。

#### 方式 B：UUMit 应用网关（公网稳定地址）

UUMit 的电脑客户端会把「本机正在运行的应用」映射到一个稳定地址，**电脑与客户端需保持在线**。

1. 启动史脉（推荐 `启动史脉.cmd`；长期分享建议 `pnpm build` 后 `pnpm start:lan`）；
2. 安装并登录 UUMit 电脑客户端，完成「连接这台电脑」；
3. 分享 3000 端口（任选其一；首次需在浏览器里确认一次）；
4. 内地版网页请用「限时分享链接」（默认 24 小时，可续期 / 撤销），把链接或二维码发给朋友；海外版可直接设为「所有人」。

```powershell
# 一条命令分享
npx @uumit-ai/uumit share 3000

# 或使用已安装的客户端 CLI
uumit-connector share 3000
```

也可以在客户端的「应用 → 发布应用」中填写 `http://127.0.0.1:3000`。

注意：

- UUMit 只需分享 **3000** 端口：`/api/*` 由 Next 服务端代理到本机 8000，朋友浏览器不会直接访问 8000；
- 如果用 `启动史脉.cmd`（dev 模式）分享：V0.9.0 已默认放行 UUMit 隧道域名，通常无需额外配置；隧道域名不在默认范围时加入 `ALLOWED_DEV_ORIGINS`。更省事、更稳的做法是用生产模式 `pnpm build` + `pnpm start:lan`。
- 电脑关机 / 睡眠后地址会显示「电脑不在线」；可在客户端开启「防止电脑睡眠」，或执行 `uumit-connector config set prevent_sleep on`；
- UUMit 会先检测首页内容再生成链接；打不开时先在本机确认 <http://127.0.0.1:3000> 正常；
- 本项目内测版**没有登录鉴权**，不要设为「所有人」，只通过「限时分享链接 / 邀请」发给可信朋友；也不要分享 8000 端口。

#### CORS / 代理配置速查（仅在浏览器直连后端时需要）

| 变量 | 作用 | 默认值 |
|---|---|---|
| `ALLOW_ORIGINS` | 允许的前端 Origin，逗号分隔 | `http://localhost:3000,http://127.0.0.1:3000` |
| `ALLOW_ORIGIN_REGEX` | 允许的 Origin 正则；置空字符串可关闭私有网段通配 | 放行 `localhost` / `127.0.0.1` / `10.x` / `192.168.x` / `172.16–31.x` 的任意端口 |
| `API_PROXY_TARGET` | Next 同源代理指向的后端地址（前端启动 / 构建时读取） | `http://127.0.0.1:8000` |
| `ALLOWED_DEV_ORIGINS` | 仅 dev 模式：额外放行的 hostname，逗号分隔、不带协议 / 端口；本机局域网 IPv4 与 UUMit 隧道域名已自动放行 | 空 |
| `NEXT_PUBLIC_API_BASE` | 前端健康检查直连后端时使用；默认留空走同源 `/api` | 空 |

```powershell
# 例：仅当浏览器直连后端、且前端来自 UUMit 域名时，才需要显式加白名单
$env:ALLOW_ORIGINS = "http://localhost:3000,https://app-3000--xxx.uua2a.com"
uvicorn main:app --host 0.0.0.0 --port 8000
```

> 朋友的 IP 各不相同也没关系：默认正则已覆盖所有私有网段，**不需要**为每个朋友的 IP 改代码。

---

## 五、数据规模与统计

### 5.1 时间轴事件

| 朝代 / 时期 | 年代范围（史书纪年） | 事件数 |
|---|---|---:|
| 夏 | 约前 2070 起 | 13 |
| 商 | 约前 1600 起 | 15 |
| 西周 | 前 1046 起 | 22 |
| 春秋 | 前 770 – 前 476 | 45 |
| 战国 | 前 475 – 前 221 | 55 |
| 秦 | 前 221 – 前 207（含前 206） | 33 |
| 西汉 | 前 206 – 公元 23（含楚汉之际、新莽） | 53 |
| 东汉 | 25 – 220（220 年禅代归三国） | 57 |
| 三国 | 220 – 280 | 11 |
| 西晋 | 265 – 316 | 7 |
| 东晋十六国 | 317 – 420（十六国附见） | 10 |
| 南北朝 | 420 – 589 | 15 |
| 隋 | 581 – 618 | 22 |
| 唐 | 618 – 907（含武周） | 50 |
| 五代十国 | 907 – 979（十国附见） | 28 |
| 辽 | 916 – 1125（与北宋并立） | 19 |
| 北宋 | 960 – 1127 | 34 |
| 西夏 | 1038 – 1227（与宋、辽、金并立） | 12 |
| 金 | 1115 – 1234（与南宋并立） | 19 |
| 南宋 | 1127 – 1279（与金、西夏并立） | 26 |
| 元 | 1271 – 1368（含大蒙古国前史） | 38 |
| 明 | 1368 – 1644 | 41 |
| 清 | 1644 – 1912（含后金前史） | 45 |
| **合计** | **约前 2070 – 1912（全朝代）** | **670** |

- 时间轴已覆盖夏—清共 23 个朝代/时期；V0.8.2 一次性新增 **174 条**事件（元 28 / 清 23 / 明 21 / 北宋 19 / 南宋 18 / 辽 16 / 金 16 / 西夏 10 / 五代十国 7 / 隋 6 / 唐 5 / 南北朝 3 / 西汉 2），把此前偏薄的宋辽夏金元明清补到与秦汉同级别的厚度；V0.7.0 曾灌入隋唐宋元明清 131 条、V0.7.1 补隋唐五代 34 条。
- 夏、商年代依「夏商周断代工程」推定，卡片描述中标注「约」。
- 参与者数据（`participants`）随事件同步整理；夏、商、西周另有 17 条为事件描述型，暂不设人物节点。
- **重要度**（`importance`，V0.6.3 起）：3 = 顶级、2 = 重要、1 = 一般，缺省视为 2；当前 **136 条**标为 3（先秦 18 / 秦汉 16 / 三国 9 / 魏晋南北朝 16 / 隋唐 17 / 五代辽宋夏金 33 / 元明清 27），简阅模式只渲染这一层级。

### 5.2 人物关系图数据

| 分期 / 断代 | 覆盖朝代 | 人物节点 | 关系边 | 默认中心人物 | 视图 |
|---|---|---:|---:|---|---|
| 春秋 | 春秋 | 81 | 117 | 孔子 | 细览 |
| 战国 | 战国 | 114 | 186 | 商鞅 | 细览 |
| 秦汉 | 秦 / 西汉 / 东汉（至 184） | 183 | 368 | 刘邦 | 细览 + 简阅 |
| 三国 | 东汉末（188 起）/ 三国 | 64 | 179 | 曹操 | 细览 + 简阅 |
| 西晋 | 曹魏末 / 西晋 | 36 | 71 | 司马炎 | 细览 + 简阅 |
| 东晋十六国 | 东晋 / 前秦 / 十六国 | 29 | 33 | 谢安 | 细览 + 简阅 |
| 南北朝 | 东晋末 / 南北朝 | 46 | 56 | 孝文帝 | 细览 + 简阅 |
| 隋 | 隋 | 23 | 50 | 杨坚 | 细览 + 简阅 |
| 唐 | 唐 | 77 | 114 | 李世民 | 细览 + 简阅 |
| 五代十国 | 五代十国 | 38 | 46 | 赵匡胤 | 细览 + 简阅 |
| 北宋 | 北宋 | 53 | 113 | 赵匡胤 | 细览 + 简阅 |
| 南宋 | 南宋 / 金 / 北宋 | 61 | 116 | 岳飞 | 细览 + 简阅 |
| 辽 | 辽 / 五代十国 / 北宋 / 金 | 45 | 72 | 耶律阿保机 | 细览 + 简阅 |
| 西夏 | 西夏 / 北宋 | 29 | 46 | 李元昊 | 细览 + 简阅 |
| 金 | 金 / 南宋 / 北宋 | 87 | 166 | 完颜阿骨打 | 细览 + 简阅 |
| 元 | 元 / 金 / 南宋 | 76 | 119 | 忽必烈 | 细览 + 简阅 |
| 明 | 明 | 76 | 125 | 朱元璋 | 细览 + 简阅 |
| 清 | 明末 / 清 | 76 | 136 | 康熙帝 | 细览 + 简阅 |
| 先秦 | 夏 / 商 / 西周 / 春秋 / 战国 | 229 | 334 | 周公旦 | 简阅 |
| 魏晋南北朝 | 三国末 / 西晋 / 东晋十六国 / 南北朝 | 104 | 156 | 刘裕 | 简阅 |
| 隋唐 | 隋 / 唐 | 98 | 163 | 李世民 | 简阅 |
| 宋辽金夏 | 五代十国 / 北宋 / 南宋 / 辽 / 西夏 / 金 | 205 | 384 | 赵匡胤 | 简阅 |
| 元明清 | 元 / 明 / 清 | 199 | 334 | 朱元璋 | 简阅 |

- 节点与边由事件数据自动生成：同一事件的参与者两两成边，边权重 = 两人共同参与的事件数。
- 18 期 + 7 组（其中秦汉 / 三国两组与细览共用图数据）互相独立，跨期人物各自计数；**V0.8.2.1 起秦汉 / 三国按年份严格分界**：秦汉图只收东汉 184 年及以前（黄巾起义）的事件，三国图 = 三国事件 + 东汉 188 年起的汉末群雄事件（讨董—襄樊，作为三国前史），曹操、刘备、孙权、吕布等不再出现在秦汉图。V0.8.2 起各期事件池按「同期并立政权互见」重排：金期读金 + 南宋 + 北宋末四事（海上之盟 / 金军南下 / 开封保卫战 / 靖康之变），辽期补高梁河、雍熙北伐、澶州之战与金灭辽，西夏期补五路伐夏、永乐城，南宋期补搜山检海、顺昌之战与靖康，元期补三峰山、联蒙灭金、襄樊、临安降元、崖山，清期补萨尔浒与己巳之变；与时间轴「一个事件只归一个朝代」的口径互不冲突。
- 魏晋三期的事件来源有两类：时间轴既有 32 条 + `weijin-events.ts` 的 34 个图谱补足事件（解析 `docs/史脉_第一批_魏晋南北朝.md`；同题事件复用时间轴 id，不重复造事件、不计入时间轴 670 条的总数）。V0.8.2 补入南朝易代三事（萧齐 / 萧梁 / 陈陈）使三家开国人物成边。
- 左侧「名人堂」快捷导航由 `KEY_FIGURES` 配置（三国 10 位、唐 10 位，其余每期 6—10 位）；三国视图左栏顶部另有魏、蜀、吴阵营快捷按钮。搜索支持 **64 条**本名 / 庙号别名（V0.8.2 补宋金元明清 19 条，如「宋钦宗」→ 赵桓、「完颜兀术」→ 完颜宗弼、「朱祁镇」→ 明英宗、「溥仪」→ 宣统帝）。
- **两人关系**（`person-relations.ts`）：按人物对校订关系定性（对手 / 君臣 / 盟友 / 政敌 …）与逐事件简述；当前 **639 对**（V0.8.2 新增 179 对随 174 条新事件同步校订；V0.8.2.1 清理 1 条无共同事件的「成吉思汗 × 忽必烈」后为 639 对）。关系随边归属：三国图 176/179 近全覆盖，秦汉图 27/368（楚汉关系为主，汉末关系已随边移入三国图）；当前各期覆盖：北宋 41/113、辽 23/72、金 57/166、元 46/119、明 48/125、清 51/136、五代十国 17/46；简阅先秦 29/334、魏晋南北朝 95/156、隋唐 60/163、宋辽金夏 135/384、元明清 129/334；未覆盖边回退事件正文摘要（与春秋战国口径一致）。
- **简阅 / 细览**：细览按 18 个细分分期展示；简阅按 7 个大断代聚合（先秦 / 秦汉 / 三国 / 魏晋南北朝 / 隋唐 / 宋辽金夏 / 元明清）。切换时当前中心人物在目标图中存在则保留，否则落到目标期默认中心。

---

## 六、数据模型与核心约定

### 6.1 事件结构

```ts
export interface TimelineEvent {
  id: string;            // 稳定唯一 id，只增不改
  title: string;
  dynasty: Dynasty;      // "夏" | "商" | "西周" | "春秋" | "战国" | "秦" | "西汉" | "东汉"
                         // | "三国" | "西晋" | "东晋十六国" | "南北朝" | "隋" | "唐"
                         // | "五代十国" | "辽" | "北宋" | "西夏" | "金" | "南宋" | "元" | "明" | "清"
  year: number;          // 史书纪年：公元前为负数（前 221 → -221），公元为正数；0 非法
  description: string;   // 60–110 字原创摘要，附出处括注
  importance?: 1 | 2 | 3; // 重要度：3 顶级（简阅只渲染 3）/ 2 重要 / 1 一般，缺省 2
  participants: readonly string[]; // 明确可识别的人物；军队、政权、泛称群体不入内
}
```

### 6.2 年份铁律：不存在公元 0 年

所有年份运算统一先转「天文纪年」，避免公元前后跨越时的 off-by-one：

```ts
// 天文纪年 = 连续整数轴（含 0 年，仅用于运算，不展示）
A(y) = y < 0 ? y + 1 : y
```

- 数据中 `year === 0` 属非法数据，构建人物图时会直接抛错。
- 展示层统一由 `formatYear()` 输出「公元前 / 公元」格式。

### 6.3 人物关系网数据

```ts
interface PersonGraphNode {
  id: string;                       // 人物通称，如「吴王阖闾」「越王勾践」「秦始皇」
  name: string;
  dynasty: Dynasty;                 // 以最后一次出现的事件所属朝代为准
  relatedPeople: readonly string[]; // 一度关系（自动计算）
  relatedEvents: readonly GraphEventReference[];
}

interface GraphEventReference {
  id: string;
  title: string;
  dynasty: Dynasty;
  year: number;
  summary: string;                  // 事件正文摘要，关系面板缺省回退使用
}

interface PersonGraphEdge {
  id: string;
  source: string;
  target: string;
  weight: number;                   // 共同参与事件数
  sharedEvents: readonly GraphEventReference[]; // 可直接展示的共同事件
  relation?: {                      // 人工校订的两人关系（person-relations.ts）
    label: string;                  // 关系定性：对手 / 君臣 / 盟友 / 政敌 …
    description?: string;           // 关系来龙去脉
    eventSummaries: Record<string, string>; // 按事件 id 的两人视角简述
  };
}
```

### 6.4 关键约定

- **单一事实源**：时间轴与人物图共享同一份 `TIMELINE_EVENTS`；关系网不是独立维护的，而是由事件参与者派生。
- **数据层加法**：V0.x 各版本只追加数据（事件、参与者、分期配置、关系数据），不重写时间轴渲染逻辑与 `PersonGraph2D` 组件；新增事件由时间轴自动落位、由关系图自动成边。
- **关系数据与事件库解耦**：两人关系按「人物对」维护在 `person-relations.ts`，图谱构建时按统一排序口径挂到边上；补数据只改这一个文件，跨分期自动生效。
- **不可变 id / year**：既有条目的 `id` 与 `year` 只增不改，保证深链接与数据迁移稳定。
- **分期隔离**：人物图按 `PERSON_GRAPH_ERAS`（细览 18 期）/ `PERSON_GRAPH_SCOPES`（简阅 7 组）构建，切换分期时当前中心人物在目标图中存在则保留，否则回落到该期默认中心；阵营快捷按钮按当前视图配置显隐。
- **视图双模**：时间轴与图谱共享同一套「简阅 / 细览」语义；聚合映射（`DYNASTY_GROUPS`）与分期映射（`ERA_TO_SCOPE` / `SCOPE_TO_ERA`）集中在数据层，页面只做状态保持。
- **页面与组件解耦**：三栏布局、搜索、名人堂、阵营按钮全部在页面外层实现；力导向图组件只接收 `data` / `centerPersonId` / `onCenterPersonChange` 三个入参。

---

## 七、版本路线图

| 版本 | 主题 | 状态 |
|---|---|---|
| V0.1 – V0.4 | 全栈骨架 + 夏商周、秦汉全朝代时间轴（272 条中的夏—东汉） | 已完成 |
| V0.4.1 | 秦汉人物 2D 关系图（122 条事件 → 人物网络） | 已完成 |
| V0.5 / V0.5.1 | 春秋战国时间轴补遗（+14 条）+ 春秋战国人物关系网（3 个分期） | 已完成 |
| **V0.5.2** | 图谱三栏导航：搜索 + 名人堂 + 画布 + 关系面板 | 已完成 |
| V0.6 | 三国两晋南北朝时间轴（+41 条事件，12 个朝代/时期） | 已完成 |
| V0.6.1 | 三国人物关系网（37 人 / 87 关系 + 阵营快捷按钮 + 关系详情升级） | 已完成 |
| V0.6.2 | 三国图谱人物与前置事件扩充（19 条汉末事件 → 62 人 / 173 关系） | 已完成 |
| V0.6.3 | 简阅 / 细览双视图 + 先秦图谱（219 人 / 316 边）+ 先秦与楚汉关系补全 | 已完成 |
| V0.6.4 | 魏晋南北朝图谱（西晋 / 东晋十六国 / 南北朝 3 期 + 简阅 1 组）关系数据 + Tab 横向滑动补丁 | 已完成 |
| V0.7.0 | 全量朝代数据灌入：隋唐宋元明清 131 条事件、23 个朝代 Tab、简阅 7 断代（图谱分期留待后续） | 已完成 |
| V0.7.2 | 隋唐与五代辽宋夏金图谱：细览 15 期 / 简阅 6 组、关系库 +99 对 | 已完成 |
| V0.8.0 | 元明清图谱独立里程碑：细览 18 期 / 简阅 7 组、关系库 +50 对；`/graph` 顶部文案极简重构 | 已完成 |
| V0.8.1 | 全量数据整合收尾（校验脚本、tsc / build / CDP 回归） | 已完成 |
| V0.8.2 | 全朝代数据厚度对齐：宋辽夏金元明清 +174 条事件、关系库 461 → 640 对；合并 docs 01—06；`scripts/validate-data.mjs` 全量校验脚本入库 | 已完成 |
| V0.8.2.1 | 修复图谱分期串期：秦汉按 184 年截止、三国收汉末前史，曹操等三国人物移出秦汉图；全分期隔离 + 名人堂同步校验 | 已完成 |
| V0.8.2.2 | 时间轴特殊节点及致敬横幅（隐藏彩蛋） | 已完成 |
| **V0.9.0** | **内测版封装：聊天问答入口封印为「开发中」、`/api` 同源代理 + 可配置 CORS、局域网 / UUMit 分享部署说明** | 已完成（tag `v0.9.0`） |
| **V1.0.1** | **Agent 前置基建纵切片：人物主数据与消歧、引用结构化、三份契约、数据快照、只读 API、AppShell / ActionBus、组件受控接口与深链接、30 条评测夹具、模型能力实测** | **已完成（tag `v1.0.1`）** |
| V1.0.2 | Agent 工具层：8 个只读工具的可执行实现 + 工具契约测试 | 已完成（tag `v1.0.2`） |
| V1.0.3 | 规划器与问答生成（tool calling 为主 / JSON 兜底） | 已完成（tag `v1.0.3`） |
| V1.0.4 | 动作联动：同页自动 / 跨页确认、全量 URL 状态化、时间轴与图谱高亮、对话 UI | 已完成（准备发布 tag `v1.0.4`） |
| V1.0.5 | 检索与引用校验：RAG 史料向量库（chromadb + bge-small-zh-v1.5）+ `search_historical_text` 工具 + 图谱/RAG 混合路由与「史料记载有异」冲突标注 + LLM 自动降级（429/502/504/超时 → 备用轻量模型，`trace.model_used`） | 已完成（tag `v1.0.5`） |
| V1.0.5.1 | Agent 对比任务优化（`tool_batch` 并行只读工具 + 对比 Prompt 三阶段 + 有界收尾轮 / 校验修复轮 + 检索词扩展）与 `/ask` 对话工作区 UI 重构（单一滚动、长回答完整显示、返回聊天状态保留、V1.0.6 多轮布局预留） | 已完成（tag `v1.0.5.1`） |
| V1.0.6 | 多轮记忆与实体承接 | 计划中 |
| V1.1 | 终极 UI 重构（3D 视图、滑块交互） | 计划中 |
| V1.1.1 | 时间轴尽头彩蛋节点（1893-12-26） | 计划中 |

版本编号规则：`V0.x` 为时间轴深度扩充主版本，`V0.x.1` 为该时期的人物关系网 / 数据修复次版本；`V1.0` 接入 Agent 与 RAG；`V1.1` 为终极 UI 重构。元明清图谱自 V0.8.0 起由原计划的 V0.7.3 提升为**独立里程碑 V0.8**；V0.8.1 承接全量校验收尾，V0.8.2 完成全朝代数据厚度对齐，V0.8.2.1 修复图谱分期串期，V0.8.2.2 加入时间轴彩蛋，V0.9.0 为面向朋友的首次内测封装版（功能冻结、只做 UI 封印与部署准备），**V1.0.1 为 Agent 接入前的基建出口**（不交付规划器与真实问答，只交付可被别人依赖的基座）。

---

## 八、数据来源与许可声明

本项目的数据来自以下公开来源，**仅用于个人学习、研究与非商业演示**。

### 8.1 史记知识库（shiji-kb）— CC BY-NC-SA 4.0

- 来源：[baojie/shiji-kb](https://github.com/baojie/shiji-kb)（《史记》章节事件索引与原文引用）。
- 许可：**Creative Commons 署名—非商业性使用—相同方式共享 4.0 国际（CC BY-NC-SA 4.0）**。
- 本项目义务：在时间轴页面页脚与本 README 中**署名**原作者与项目；**不得用于商业用途**；如对数据再分发或改编，须以**相同许可**共享。
- 商业使用需另行联系数据作者获得授权；《史记》原文本身属**公有领域**。

### 8.2 其他史料与事实来源

| 来源 | 内容 | 许可 / 状态 |
|---|---|---|
| 《汉书》《后汉书》原文 | 西汉中后期、东汉事件描述依据 | 公有领域 |
| 《三国志》《晋书》《宋书》《魏书》《梁书》《北齐书》《周书》《隋书》 | 三国两晋南北朝 40 条新增事件的描述依据 | 公有领域 |
| 《左传》《墨子》《晏子春秋》《汉书·食货志》 | 春秋战国 14 条补遗事件的依据 | 公有领域 |
| [anthonyhann/chinese-history](https://github.com/anthonyhann/chinese-history) | 朝代起始年、年号与公元纪年口径 | **CC0 1.0**（事实数据） |
| 《资治通鉴》 | 年号与公元纪年交叉校验 | 公有领域 |

### 8.3 原创内容与代码许可

- **事件摘要**：基于上述来源整理、压缩、改写的原创摘要，逐条保留出处括注（如「据《史记·周本纪》」）；引用原文的著作权归原作者 / 公有领域，摘要文字由本项目整理。
- **代码**：本仓库原创代码以 [MIT License](LICENSE) 开源。
- **数据与第三方内容**：MIT 许可仅适用于原创代码及其相关文档，不改变上文所列史料、第三方数据及其各自许可条件；尤其是基于 `shiji-kb` 的数据仍受 CC BY-NC-SA 4.0 约束，不得用于商业用途，并须遵守署名与相同方式共享要求。
- 本项目为个人学习 / 研究性质的非商业项目；不得将 shiji-kb 派生数据用于商业用途。

---

## 九、文档

| 文档 | 说明 |
|---|---|
| [SPEC.md](SPEC.md) | 需求与验收标准的**唯一来源**；实现中出现未覆盖行为时先补 SPEC 再写代码 |
| [CHANGELOG.md](CHANGELOG.md) | 按版本记录新增 / 变更 / 修复与数据快照 |
| [docs/V1.0-项目现状与开发前置审核报告.md](docs/V1.0-项目现状与开发前置审核报告.md) | V1.0 架构审核：P0 缺口、契约草案、Q1–Q6 决策与开工清单 |
| [docs/V1.0.1-任务卡拆解.md](docs/V1.0.1-任务卡拆解.md) | V1.0.1 基建阶段 11 张任务卡（TC-01~TC-11）与验收标准 |
| [docs/V1.0.1-验收记录-纵切片.md](docs/V1.0.1-验收记录-纵切片.md) | TC-01~TC-07 纵切片的逐卡验收记录、命令与偏差说明 |
| [docs/V1.0.1-验收记录.md](docs/V1.0.1-验收记录.md) | **V1.0.1 出口验收**：TC-01~TC-11 逐项勾选、12 步门禁输出、快照 hash 与手工验收记录 |
| [docs/V1.0.2-工具层设计.md](docs/V1.0.2-工具层设计.md) | 8 个只读工具的口径、统一返回信封、真实返回示例与验收记录 |
| [docs/V1.0.3-Agent-Core设计.md](docs/V1.0.3-Agent-Core设计.md) | Agent Core：数据结构、JSON 协议、工具注册表、证据校验、API 测试方法 |
| [docs/V1.0.4-Agent-UI数据层设计.md](docs/V1.0.4-Agent-UI数据层设计.md) | V1.0.4 前端 Agent 数据层：AgentContext / ActionBus / 动作联动调用链与手工验收 |
| [docs/V1.0.5-RAG混合检索设计.md](docs/V1.0.5-RAG混合检索设计.md) | V1.0.5 RAG 混合检索：入库管道、embedding 选型、`search_historical_text`、图谱/RAG 分节与冲突标注 |
| [docs/V1.0.5.1-Agent对比任务与对话工作区设计.md](docs/V1.0.5.1-Agent对比任务与对话工作区设计.md) | V1.0.5.1 对比任务优化（并行工具 / 收尾轮 / 校验修复轮）与对话工作区 UI 重构：根因、布局、状态保留、V1.0.6 预留边界与验收数据 |
| [docs/component-capability-map.md](docs/component-capability-map.md) | TC-08 组件能力现状、受控接口、深链接与 V1.0.4 缺口清单 |
| [contracts/README.md](contracts/README.md) | 三份契约的冻结规则、版本升级规则与字段清单 |
| [docs/spikes/README.md](docs/spikes/README.md) | TC-10 模型能力复现说明（env、命令、失败码、10 项探针结论） |
| [docs/spikes/modelscope-qwen3.5-35b-a3b-capability.md](docs/spikes/modelscope-qwen3.5-35b-a3b-capability.md) | `Qwen/Qwen3.5-35B-A3B` 实测报告（连通性 / JSON / tool calling / SSE / 中文 / 思考开关 / V1.0.3 建议） |
| [evals/README.md](evals/README.md) | 30 条 golden 用例的分类、contract 校验口径与 live 评分计划 |
| [docs/person-same-name-report.md](docs/person-same-name-report.md) | 人物同名组、异名合并与裁决结论 |
| [docs/source-review.md](docs/source-review.md) | 事件引用结构化口径、例外与抽查记录 |
| [backend/data/README.md](backend/data/README.md) | 数据快照字段、生成方式与禁止手改说明 |
| 本 README | 项目介绍、运行方式、数据规模、数据来源与许可 |

---

## 十、已知限制

- V1.0.1 起后端提供**只读数据服务**（快照 + `/api/meta` + `/api/entities/*` + `/api/agent/ping_llm`）；V1.0.3 新增唯一写入口 `POST /api/agent/ask`（问答）。仍**不接数据库**；页面渲染在 V1.0 仍读前端 TS 数据。
- 页面渲染数据链路（时间轴 / 图谱）与人物 `person_id` 尚未合并：图谱节点仍以姓名为 id，关系库 `person_id` 迁移属 V1.1；因此 `PersonGraph2D` 的受控 `selectedPersonId` / `onPersonSelect` 当前参数是**图节点 id（姓名）**，语义待 V1.1 切换。
- 问答前端已接入真实 `POST /api/agent/ask`（V1.0.4 起）；V1.0.5.1 把 `/ask` 重构为对话工作区，但**仍是单轮问答**：
  不做多轮上下文拼接 / Conversation Memory / 历史消息持久化（属 V1.0.6）；当前只做了 UI 结构与静态布局预览
  （`/ask?preview=multiturn`）。
- V1.0.5.1 对比任务的回答完整度取决于 RAG 语料覆盖范围：语料未覆盖「历史局限」等维度时，服务端按既有规则
  标注缺失或降级 `insufficient`，不会编造；`search_events` 的「人物名 + 事件词」扩展只覆盖有限事件词后缀。
- 本地 RAG 向量库为 gitignore 构建产物，需在 `backend` 下执行
  `backend\.venv\Scripts\python backend\scripts\ingest_rag.py` 重建；未构建时 RAG 工具返回失败信封，
  Agent 会退回图谱证据或如实说明资料不足。
- 本版歧义实体（如「梁太后」）不返回 `clarification` 候选列表，由模型输出 `insufficient` 提示用户指定；澄清状态机属多轮记忆版本。
- ActionBus 已在时间轴 / 图谱页注册**同页**动作，但跨页动作只有待确认队列、**没有确认按钮 UI**；完整动作联动属 V1.0.4。
- 深链接只做「打开链接恢复视图 + 动作执行后回写 URL」，**不做全量 URL 状态化**（每次点击同步 query、浏览器前进后退恢复属 V1.0.4）。
- 评测骨架只跑 **contract 模式**（schema / ID / 动作策略 / 引用纪律的离线校验）；真实 LLM 评分在 V1.0.3 之后接入。
- Agent 默认 `enable_thinking=false`（顶层参数）追求极速；长文解释若需思考模式，需显式提高超时到 90–120s（见 [能力报告](docs/spikes/modelscope-qwen3.5-35b-a3b-capability.md)）。
- 人物关系网为**一度关系视图**（只展示当前中心人物的直接关系），不做多跳裁剪与全图布局。
- 时间轴为**精选数据**而非穷举：每个朝代只收录关键事件（当前共 670 条）。
- 人物关系由图数据派生，未接入自动抽取；`participants` 采用人工校订口径。
- **两人关系数据**目前覆盖 **639 对**，覆盖 25 张图谱中的 1353 条边；春秋、战国图与部分秦汉 / 宋元明清人物对尚无关系徽章，面板事件简述回退事件正文。关系定性为人工裁断，存在可讨论空间（如「盟友→反目」按最终结果标注）。
- **补足事件**：魏晋图谱有 34 条事件只进人物图、不进时间轴（`weijin-events.ts`），因此这些事件在时间轴上不可见；时间轴仍只展示 `timeline-events.ts` 的 670 条精选事件。
- **简阅模式**只展示 `importance === 3` 的顶级事件（当前 136 条），其余事件需切回细览查看；简阅图谱与时间轴断代口径一致（魏晋南北朝包含西晋 / 东晋十六国 / 南北朝三期）。
- 移动端非优先设计：桌面体验完整，窄屏仅保证可浏览与可用。
- **内测分享无鉴权**：V1.0.1 仍没有账号 / 登录体系，任何拿到链接的人都能浏览；请只用局域网或 UUMit「限时分享链接 / 邀请」发给可信朋友，不要公开到互联网。
- **分享时后端为可选**：时间轴与人物关系图为纯前端数据，后端只承担健康检查；即使 `后端未连接`，两个主模块仍可完整使用。

---

## 十一、致谢

- 感谢 [史记知识库 shiji-kb](https://github.com/baojie/shiji-kb) 提供结构化《史记》事件索引与原文数据。
- 感谢 [chinese-history](https://github.com/anthonyhann/chinese-history) 提供中国历史纪年事实数据。
- 感谢 [d3](https://d3js.org/) 生态提供力导向布局与选择集能力。

---

## 十二、更新日志（近期）

> 完整版本记录见 [CHANGELOG.md](CHANGELOG.md)。

### V1.0.5.1（Agent 对比任务优化 + 对话工作区重构） — 2026-11-24

- **Agent 对比任务修复**：「王安石变法和商鞅变法的区别」从 `insufficient` 修复为 **3 轮 grounded**：
  内部新增 `action=tool_batch`（并行 2–4 个只读工具，工具总数仍硬限 10）、System Prompt 增加对比任务
  「并行定位 → 并行取证 → final」三阶段策略、轮次耗尽后的有界收尾轮（禁止工具，允许一次 JSON 修复）
  与证据校验修复轮（重写 final 仍必须通过原校验）；`search_events` 支持「人物名 + 事件词后缀」扩展检索词，
  「王安石变法」一次命中图谱事件「熙宁变法」。外部 API 契约与三态状态完全不变。
- **`/ask` 对话工作区 UI 重构**：单一页面滚动 + 纵向对话时间线 + 底部输入区；修复「长回答被固定高度 /
  嵌套滚动 / flex 撑破卡片裁切」与「返回聊天后问题丢失」（sessionStorage 会话持久化、SSR 安全恢复、
  滚动位置恢复、旧副驾驶面板不重开）；新增共享 Markdown 渲染器与静态多轮布局预览
  `/ask?preview=multiturn`，为 V1.0.6 多轮对话预留结构。
- **版本与测试**：前端 / 后端版本号统一 `1.0.5.1`，契约导出物与前端类型同步重建；后端 **318 passed**、
  前端 **119 passed**、`tsc` / `next build` 通过、`verify.ps1` 12 步门禁全绿、真实 LLM 验收 4/4 通过、
  Edge 无头 UI 验收 **39/39** 通过。

### V1.0.5（RAG 混合检索 + LLM 自动降级） — 2026-11-24

- 新增 `backend/rag/`（语料解析 → 切分 → embedding → chromadb 向量库）与第 9 个只读工具
  `search_historical_text`；Agent 采用「图谱基础事实 → RAG 史料细节」混合路由，年份冲突标注
  「史料记载有异」，传说句首 `[传说]`，图谱与 RAG 双空必须 `insufficient`；轮次硬上限 4 → 6。
- 主模型 429/502/504/超时自动切换备用轻量模型并回填 `trace.model_used`；前端在非 35B 时提示已降级。

### V1.0.1（Agent 前置基建版） — 2026-11-23

- **版本与出口**：`frontend/package.json`、首页 / 图谱页 / 时间轴版本标识、浏览器标题与 FastAPI `APP_VERSION` 统一为 **1.0.1**；`scripts/verify.ps1` 12 步全绿，打 tag `v1.0.1`。
- **TC-08 组件受控与深链接**：`PersonGraph2D` 新增可选 `highlightedPersonIds` / `selectedPersonId` / `onPersonSelect`，不传时完全保持 V0.9.0 行为；ActionBus 在 `/timeline`、`/graph` 注册同页动作并在执行后回写深链接；支持 `/timeline?event=`、`/graph?person=&era=&mode=` 直接恢复视图；新增 `lib/graph-selection.ts`、`lib/deep-links.ts`、`lib/action-capabilities.ts` 与能力映射文档。
- **TC-09 评测骨架**：`evals/golden.v1.json` 30 条用例覆盖 12 类（公元前年份 / 同名歧义 / 资料不足 / 跨朝代 / 关系 / 对比 / 超范围 / 彩蛋排除 / 仅图谱事件 / 多轮 / 事件人物联动 / UI 动作策略）；`scripts/run-evals.mjs --mode contract` 校验 schema、快照绑定、0 悬空 ID、工具入参、动作策略、引用纪律，并含负向自测；已接入 `verify.ps1` 第 11 步。
- **TC-10 模型能力实测**：`Qwen/Qwen3.5-35B-A3B` 连通性 / JSON 模式 / tool calling / SSE / 中文回答 / 确定性全部实测通过；发现默认思考模式开销高且 `max_tokens` 不限制 reasoning，报告给出 V1.0.3 的 tool calling + JSON 兜底路线与参数建议。
- **测试**：后端 pytest **87 passed**；前端 vitest **66 passed**；评测 contract **30/30**。
- **文档**：README / CHANGELOG / SPEC（新增 §7.17–§7.19）/ 任务卡状态 / 验收记录 / spike 报告 / 能力映射全部同步。

### V0.9.0（内测版） — 2026-11-21

- **首页入口封印**：`/` 的「聊天问答」入口改为置灰 + 虚线边框 +「开发中」标签；点击不再跳转，只弹出 Toast「Agent 智能问答模块正在闭关开发中，敬请期待！」，时间轴 / 人物关系图入口保持不变。
- **全局版本**：`frontend/package.json`、首页 / 图谱页版本标识、浏览器标题与 FastAPI `version` 同步至 **V0.9.0（内测版）**。
- **分享部署加固**：Next 新增 `/api/*` 同源代理（`API_PROXY_TARGET`，默认 `http://127.0.0.1:8000`），健康角标在局域网 IP / UUMit 隧道下也正常；后端 CORS 改为 `ALLOW_ORIGINS` / `ALLOW_ORIGIN_REGEX` 可配置，默认放行全部私有网段。
- **文档**：README 新增 §4.7「分享给局域网 / 公网测试」（局域网防火墙、`pnpm dev:lan`、UUMit `uumit-connector share 3000`、CORS 速查）；`/api/health` 返回 `{"ok": true, "version": "0.9.0"}`。
- **验证**：`tsc --noEmit` 0 error、`next build` 通过、CDP 实测入口 Toast 不跳转、健康角标显示「后端已连接」、`/timeline` 与 `/graph` 正常。

### V0.8.2.2 — 2026-11-21

V0.8.2.2 新增时间轴特殊节点及致敬横幅（隐藏彩蛋）

### V0.8.2.1 — 2026-11-20

- **修复图谱分期串期**：`/graph` 切到「秦汉」时中心显示曹操、周围全是三国 / 汉末人物，与秦汉名人堂脱节。根因是秦汉图按 `dynasty === "东汉"` 收了东汉全期事件，而讨董、官渡、赤壁、襄樊等汉末事件的参与者正是三国人物。
- **修复口径**：按年份切分——秦汉图 = 秦 + 西汉 + 东汉 184 年及以前（黄巾起义，保留张衡、蔡伦、党锢等东汉人物）；三国图 = 三国事件 + 东汉 188 年及以后汉末群雄事件（讨董—襄樊作为三国前史）。时间轴「事件只归一个朝代」口径不变。
- **数据**：秦汉图 230 / 509 → **183 / 368**，三国图 63 / 176 → **64 / 179**；默认中心秦汉 刘邦（邻居韩信、项羽、陈平、萧何）、三国 曹操（邻居刘备、孙权、袁绍、吕布、关羽）；名人堂与默认中心同池校验通过。
- **全分期排查**：补正南宋 / 辽 / 金 / 元四期 `dynasties` 声明与实际事件池一致（北宋、金、南宋互见），新增「分期隔离」校验：节点必须锚定当期声明朝代、秦汉 ≤184、三国 ≥188、三国人物不得进入秦汉图，反之亦然。
- **跨期人物清洗**：清理 9 条既有事件中「晚于卒年仍参与」的跨期人物（陈桥兵变去柴荣、灭后晋去耶律阿保机、金灭辽去完颜阿骨打、蒙古灭金 / 建元去成吉思汗、靖难去朱元璋、改国号去努尔哈赤、清军入关去皇太极补吴三桂、灭后梁去朱温），并校正 13 条 V0.8.2 自撰事件的纪年笔误；关系库 640 → **639 对**。
- **文档 / 版本**：README、CHANGELOG、SPEC（新增 §7.15）、`frontend/package.json` 与 `/graph` 版本号同步至 **V0.8.2.1**。

### V0.8.2 — 2026-11-20

- **全朝代数据厚度对齐**：新增 **174 条**事件（元 28 / 清 23 / 明 21 / 北宋 19 / 南宋 18 / 辽 16 / 金 16 / 西夏 10 / 五代十国 7 / 隋 6 / 唐 5 / 南北朝 3 / 西汉 2），时间轴 496 → **670 条**；其中 25 条标记 `importance: 3`（共 136 条）。
- **图谱厚度跃升**：宋辽金夏简阅图 67 人 / 88 边 → **205 人 / 386 边**，元明清简阅图 58 / 64 → **197 / 337**；金期 7 / 6 → **87 / 170**、元期 13 / 15 → **75 / 120**、明期 27 / 26 → **76 / 126**、清期 24 / 27 → **75 / 137**，与秦汉同一数量级（分界修复后数值见 V0.8.2.1）。
- **docs 01—06 去重合并**：解析 `docs/01_先秦.md`—`docs/06_元明清.md` 共 122 行核心事件，同题事件复用既有 id、缺失事件补录（如文景之治、推恩令、萧齐 / 萧梁 / 陈陈、靖康之变、隆兴和议、联蒙灭金、郭守敬授时历、红巾军起义、土木堡之变、万历三大征、萨尔浒、收复台湾、雅克萨 / 尼布楚、甲午战争、辛亥革命），参与者按史实并集去重，不重复造事件。
- **关系库**：461 → **640 对**（+179 对，均校验「关系两端共同参与该事件」）；补齐 10 条早期事件的历史出处括注，修复全部孤儿节点（0 孤儿 / 0 悬空边）。
- **校验**：`tsc --noEmit` 0 error；新增仓库级 `scripts/validate-data.mjs`（事件 / 图谱 / 关系 / 别名 / 名人堂 / docs 六层校验），全量通过。
- **文档**：README / SPEC / CHANGELOG / `frontend/package.json` 版本同步至 V0.8.2。

### V0.8.0 — 2026-11-20

- **元明清图谱独立里程碑**：解析 `docs/史脉_第四批_元明清.md`（68 行、50 个唯一人物对），细览分期 15 → **18 期**（新增 元 / 明 / 清），简阅分组 6 → **7 组**（新增 元明清）；关系库 411 → **461 对**。
- **默认中心**：元 忽必烈、明 朱元璋、清 康熙帝；简阅元明清 朱元璋。清期补入「宁远之战」「山海关之战」两条明末前史，使清图中「努尔哈赤 × 袁崇焕」「多尔衮 × 吴三桂」成边。
- **搜索别名**：新增 22 条元明清本名 / 庙号（明太祖 → 朱元璋、清圣祖 → 康熙帝、铁木真 → 成吉思汗等，共 45 条）；名人堂新增元 / 明 / 清 / 元明清 4 组配置。
- **`/graph` 顶部文案极简重构**：删除罗列 15 期朝代与全部交互的长段落，副标题只留一行操作指引；边粗细、阵营按钮、别名搜索等复杂说明收进副标题末尾的 `?` 悬浮气泡（悬停 / 键盘聚焦显示，`prefers-reduced-motion` 下无过渡）。
- **文档**：README / SPEC / CHANGELOG 版本与统计同步至 V0.8.0；SPEC 新增 §7.12 / §7.13。

### V0.7.2 — 2026-11-20

- **图谱分期大幅扩充**：解析 `docs/史脉_第二批_隋唐.md` 与 `docs/史脉_第三批_五代辽宋夏金.md`，细览分期 7 → **15 期**（新增 隋 / 唐 / 五代十国 / 北宋 / 南宋 / 辽 / 西夏 / 金），简阅分组 4 → **6 组**（新增 隋唐 / 宋辽金夏）。
- **关系数据**：新增 **99 对**关系记录（412 条「人物对—事件」简述直接取自表内），关系库 312 → **411 对**；表中缺失的简述已按正史补全，全部关系简述命中共同事件。
- **默认中心**：隋 杨坚、唐 李世民、五代十国 赵匡胤（数据密度最高）、北宋 赵匡胤、南宋 岳飞、辽 耶律阿保机、西夏 李元昊、金 完颜阿骨打；简阅隋唐 李世民、宋辽金夏 赵匡胤。
- **稀疏期补前史**：南宋期含采石之战，辽期含割燕云十六州 / 澶渊之盟，西夏期含庆历新政 / 西北御夏，金期含海上之盟，避免图谱过空。
- **搜索 / 名人堂**：新增 11 条本名与庙号别名（唐太宗 → 李世民、宋太祖 → 赵匡胤等，共 23 条）；名人堂按 15 期 + 6 组全部配置并在页面按当期图数据过滤。
- **文档**：README / CHANGELOG 版本与统计同步至 V0.7.2。

### V0.7.1 — 2026-11-20

- **Tab 栏 UI**：滑动箭头由绝对定位覆盖改为滚动容器**外侧 flex 占位**，绝不遮挡首尾 Tab；新增指针按住拖拽滚动、松手惯性滑行（按速度衰减）、`cursor: grab / grabbing`、拖动超过 5px 自动吞掉 click 避免误切朝代。
- **数据**：补充隋唐至五代十国初期 **34 条**核心历史事件（隋 7 / 唐 18 / 五代十国 9），其中 **10 条**标记 `importance: 3`；时间轴 462 → **496 条**。
- **文档**：README / CHANGELOG 版本号与统计同步至 V0.7.1，补记 V0.7.0 数据灌入版本。

### V0.7.0 — 2026-11-20

- **全量朝代数据灌入**：解析 `docs/史脉_第二/三/四批` 关系表，归并出 **131 条**事件，新增 11 个朝代（隋、唐、五代十国、辽、北宋、西夏、金、南宋、元、明、清）；时间轴 331 → 462 条、Tab 12 → 23 个、简阅 4 → 7 个断代；46 条断代级事件。
- 首页与时间轴页脚文案同步「夏—清」覆盖范围与正史来源。
