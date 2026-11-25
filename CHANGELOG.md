# 更新日志

本文件记录「史脉 HistoLink」自 v0.1.0 起的全部版本变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循项目自定义规则：

- `V0.x`：时间轴深度扩充主版本（每版聚焦一个历史时期）；
- `V0.x.1`：该时期的人物关系网次版本 / 数据修复补丁；
- `V0.9.0`：内测版封装（功能冻结，面向朋友分享测试）；
- `V1.0.x`：Agent 接入的分阶段基建（V1.0.1 前置基建 → V1.0.2 工具层 → V1.0.3 规划器 → V1.0.4 动作联动 → V1.0.5 检索与引用校验 → V1.0.6 多轮）；`V1.1`：终极 UI 重构。

变更分类：**新增** / **变更** / **修复** / **数据** / **文档** / **验证**。日期为版本归档日期；`0.1.0` 取首个提交日期，`0.2.0 – 0.4.1` 为早期迭代的验收归档日期（早期未逐版本提交）。

---

## [1.0.5.3] - 2026-11-25（进行中 · 全面体检专项启动）

> 版本主题：**全面体检专项**——V1.0.5.2 功能封版后的全量健康检查（构建 / 数据 / 契约 / 测试 / UI·可访问性 / 性能 / 文档 / 安全），只修 P0 / P1 与门禁稳定性，不新增业务功能，为 V1.0.6 多轮对话打稳定基线。
> 体检计划、八维度检查项与基线报告：`docs/V1.0.5.3-全面体检专项.md`。

### 新增

- **UI 体检工具 `scripts/health-check-ui.mjs`**：基于 CDP + 无头 Edge 的 `/ask` 页面自动化体检。默认 22 个检查点 / 58 条断言（100vh App Shell、三栏独立滚动、点击历史不重排、悬浮「⋯」菜单与置顶 / 重命名 / 删除、新建对话、侧边栏折叠与持久化、聊天气泡 85% + 行高 1.8、预览模式无侧边栏宽版、引用 >3 折叠、史引 40/60 分屏、窄屏浮层），`--live` 追加真实问答场景（24 个检查点 / 63 条断言，含新问答自动滚动到底部）；产物为 `*.png` 截图 + `results.json`，可复现、失败即非 0 退出。
- **V1.0.5.3 专项回归测试 `backend/tests/test_regression_v1053.py`**：27 条离线用例覆盖四条主线——模型降级（429/502/504/超时自动切换备用、`model_used` / `trace.model_used`、主备皆失败错误信封）、会话隔离（history 不跨请求泄漏、并发不串扰、session_id 无共享状态）、边界兜底（空 / 超长 / 缺字段 / 非法 JSON / RAG 不可用 / 工具异常均不 500）、契约一致性（9 工具三源一致、动作类型、版本号、错误码与 envelope 字段不漂移）。
- **体检计划文档** `docs/V1.0.5.3-全面体检专项.md`：八维度检查项、四阶段执行节奏、V1.0.5.3 出口标准、2026-11-25 基线结果与首批 findings 清单。

### 修复

- **F-01 门禁稳定性（P1）**：`gen-frontend-types` / `build-persons` / `extract-sources` 的 `--check` 改为换行归一化比较（新增 `scripts/lib/text-compare.mjs`）。此前在 `core.autocrlf=true` 的 Windows 工作区，检出后的 CRLF 文件会被逐字节比较误判为「生成物过期」，导致 `scripts/verify.ps1` 偶发失败。
- **F-11 dev 水合（P2）**：`next.config.ts` 的 `allowedDevOrigins` 补充 `127.0.0.1`，修复用 `http://127.0.0.1:3000` 打开 dev 环境时 `/_next/*` dev 资源被同源策略拦截、页面 HTML 正常但无法水合（交互全失效）的问题。
- **F-13 体检工具稳定性（P3）**：`health-check-ui.mjs` 的浏览器清理改为「按 profile 路径精确补杀残留 Edge 子进程 + `process.exit` 显式收尾 + 6 分钟看门狗」，修复 headless 子进程占用 profile 锁导致复跑 EBUSY、CDP 句柄导致 Node 不退出；连续两次复跑均 0 残留。

### 验证

- 规模复检：门禁 `scripts/verify.ps1` **12/12 PASS**（总耗时 13.7s；后端 pytest **363 passed**（基线 336 + 专项回归 27） / 前端 vitest **153 passed**（基线 146 + 排序稳定性 7） / evals 30/30 / next build 3.1s）。
- `node scripts/health-check-ui.mjs --live` **24 个检查点 / 63 条断言全绿**，浏览器控制台 0 条产品级 error；默认模式 22 个检查点 / 58 条断言全绿。
- V1.0.5.2-layout 同版补丁（100vh App Shell、三栏独立滚动、侧边栏点击不重排、悬浮菜单）已合入并通过两轮 UI 体检，详见 `docs/V1.0.5.2-布局与侧边栏修复补丁.md`。
- 静态质量基线：ruff（验收范围）8 errors、全 `backend/` 44 errors、`ruff format --check` 44 文件待格式化；pytest 1 条 Starlette deprecation warning —— 均纳入 V1.0.7 清理，详见体检报告 §5。

---

## [1.0.5.2] - 2026-11-25

> 补丁版本主题：**Agent 双数据源接入（人物关系图 × 时间轴·大事记）+ 模型切换窗口 + 历史对话侧边栏**。
> 需求与开发说明唯一来源：`docs/V1.0.5.2-Agent系统提示词与前端功能开发说明.md`（v1.0.5.2 单一交付文档）。
> 保留 V1.0.5.1 全部能力；外部 API 契约只新增可选字段（`AskRequest.model_id`、`Trace.model_requested` / `Trace.sources`、新增 `GET /api/agent/models`），`SCHEMA_VERSION` 仍为 `1.0`。

### 新增

- **P0 双数据源铁律**：`backend/agent/prompts.py` 系统提示词新增「双数据源与问题分类」「双源证据分配」「回答输出规范」；所有历史类提问必须同时检索「时间轴·大事记」（`search_events` / `get_event` / `timeline_span`）与「人物关系图」（`resolve_entity` / `get_person` / `get_person_events` / `get_relation` / `get_era_graph`）两源。
- **P0 双源分节正文**：`backend/agent/validator.py` 新增 `detect_question_focus()`（人物 / 关系 / 事件 / 对比）、`check_dual_source_coverage()`（人物/关系类必须有 person/relation 证据、事件类必须有 event/rag 证据，违反即降级）、`source_coverage()`；grounded 正文按 `**[人物关系图]**` / `**[时间轴·大事记]**` 分节输出，人物/关系类关系图在前、事件类时间轴在前，单源时只输出命中节（不虚构另一节）；保留 `[传说]`、`史料记载有异` 标注。
- **P0 trace 双源观测**：`AgentResult.source_coverage` → `Trace.sources={"timeline":bool,"graph":bool}`，供前端与自动化验收识别双源覆盖。
- **P1 模型注册表与请求级选择**：`llm_client.list_model_options()` / `resolve_model_pair()`；新增 `GET /api/agent/models`（主模型 `Qwen/Qwen3.5-35B-A3B`、备用 `Qwen/Qwen3.5-8B-Instruct`，无需 API key 即可读取）；`AskRequest.model_id` 请求级选择模型（未知模型 400 `INVALID_REQUEST`）。
- **P1 双向自动降级**：手动选择任意一款模型后，另一款仍作为自动降级目标——所选模型 429/502/504/超时自动切换重试一次；异常恢复后默认仍使用主模型。手动所选模型在上游不可用（400 / 404，如账号未开通该模型）时同样自动切到另一款模型完成回答（默认主模型路径不放开 400 降级，避免掩盖请求参数错误）。
- **P1 前端模型切换窗口**：`components/agent/ModelSwitcher.tsx` —— 对话输入框左上角（输入框外部左侧）圆角下拉按钮（品牌图标 + 模型全称 + 下拉箭头），完整展示两款模型；切换立即生效、不清空对话历史；`/ask` 输入框右侧新增附件上传（V1.0.6 接入占位）与新建对话按钮（水平对齐）。
- **P2 历史对话侧边栏**：`components/agent/ConversationSidebar.tsx` + `lib/conversation-store.ts` —— `/ask` 页面最左侧独立竖向侧边栏，「今天 / 过去 30 天」分组（浅灰小字左对齐）；「今天」组首项「新建对话」选中态浅灰背景；点击历史标题加载会话、点击新建对话清空当前对话；数据层为内存实现 + 演示数据（不接真实持久化）。
- **P2 v1.0.6 占位**：`ConversationRepository` / `ConversationStorage` 接口预留持久化、跨会话上下文、重命名 / 删除 / 置顶；全部预留位置标注 `// TODO v1.0.6 多轮历史对话记忆模块 - 功能待实现`（数据层 + 侧边栏共 6+ 处）。

### 变更

- 版本号全仓库升级 `v1.0.5.2`：`backend/main.py`（`APP_VERSION`）、`backend/contracts/models.py`（`API_VERSION`）、`frontend/package.json`、首页 / 布局 metadata / 时间轴 / 人物图谱 / 抽屉状态栏、`README.md` / `SPEC.md` / `CHANGELOG.md` / `backend/.env.example` 头部；`SCHEMA_VERSION` 保持 `1.0`。
- 契约再生成：`contracts/api-v1.openapi.json`（9 条路径 / 9 个关键模型，新增 `/api/agent/models`、`ModelsResponse`、`ModelOptionResponse`）与 `frontend/lib/api-types.ts` 同步；`scripts/validate-contract.mjs` / `backend/tests/test_contracts.py` 关键路径与模型断言同步。
- `backend/agent/orchestrator.py`：`validate(..., question=...)` 传入用户问题；`_chat(..., model_id=...)` 透传请求级模型；`AgentResult` 新增 `model_requested` / `source_coverage`。
- `frontend/lib/agent-client.ts`：`fetchAgentModels()` / `modelsStateFromPayload()`（后端不可达回退静态表，不阻塞提问）；`buildAskRequest` 携带 `model_id`；`answerViewFromEnvelope` 归一化 `modelRequested` / `sources`；降级提示按「实际模型 ≠ 所选模型」判断（双向降级）。
- `frontend/contexts/AgentContext.tsx`：新增模型注册表 / 选中模型 / 历史对话仓库状态与 `selectModel()` / `newConversation()` / `loadConversation()`；v1.0.5.1 的会话恢复、ActionBus、史引联动保持不变。

### 修复

- 修复 v1.0.5.1「人物关系图数据接入了但回答里看不见」：人物/关系证据此前混在时间轴节，现按来源强制分节并加来源前缀。
- 修复 RAG-only（传说）回答会出现「本轮未获取到图谱基础事实」空节的问题：单源时只输出命中节。
- 修复 `enable_thinking` / 模型降级与手动选择冲突：手动选择备用模型时主模型作为降级目标，`model_used` 始终标明最终模型。

### 文档

- `docs/V1.0.5.2-Agent系统提示词与前端功能开发说明.md` 更新为最终实现态：修正 RAG 基线（90 篇 / 360 chunk）、文档归档文件名、补充「实现对照与验收结果」附录。

### 验证

- 后端 pytest **336 passed**（新增 `test_agent_dual_source.py` / `test_agent_models.py` / `test_llm_model_selection.py`，含手动选择模型 400 降级）；前端 vitest **141 passed**（新增 `conversation-store.test.ts` / `model-selection.test.ts`）；`tsc --noEmit` / `next build` 通过；`scripts/verify.ps1` 12 步门禁全绿；`validate-contract` 9 路径 / 9 模型通过。
- 真实 LLM 冒烟（2026-11-25）：人物类「和孔子有关系的人有哪些？」→ grounded，`[人物关系图]` 在前 / `[时间轴·大事记]` 在后，`trace.sources={"timeline":true,"graph":true}`；事件类「赤壁之战发生在哪一年？」→ grounded；手动选择 `Qwen/Qwen3.5-8B-Instruct` 实测 ModelScope 返回 400「Invalid model id」，已自动降级 `Qwen/Qwen3.5-35B-A3B` 正常回答（`trace.model_requested` = 8B、`trace.model_used` = 35B）。
- Edge headless 视觉验收：1600px 下 `/ask` 左侧历史对话侧边栏（今天 / 过去 30 天、新建对话选中态）与输入框左上角模型切换按钮正常；≤1080px 侧边栏按设计隐藏，主对话区布局不变。

### 变更（UI 呼吸感重构 · 2026-11-25 同版追加）

> 针对 V1.0.5.2 交付后「`/ask` 页面空间拥挤」的阅读体验问题追加的纯前端补丁；不改 API 契约、不改数据、不新增业务能力。

- **侧边栏折叠**：`ConversationSidebar` 头部新增 `«` 收起按钮；收起后顶栏出现「☰ 历史对话」展开入口，折叠偏好写入 `localStorage`（`histolink.ask.sidebar.v1`，刷新保持）；≤1080px 默认收起，展开时切换为左侧浮层 + 遮罩（Esc / 点击遮罩收起）。史引分屏打开时侧边栏自动让位，关闭分屏后恢复用户选择。
- **聊天区加宽与排版**：`/ask` 单栏宽度 800px → 1040px；气泡最大宽度改为聊天内容区的 **85%**；正文 15px / `line-height: 1.8`，消息内边距 18×20、对话列表 26×30 / 间距 22px。
- **引用卡片折叠**：引用 >3 条时默认只展示前 3 条，其余收进「▾ 展开全部 N 条引用」胶囊按钮（带剩余条数角标与 `aria-expanded`），点击向下展开 / 收起。
- **分屏比例自适应**：史引面板出现时 `workspaceLayout` 切换为 2fr : 3fr 网格（左对话 40% / 右面板 60%，1600px 实测 610 : 916）；无史引且侧边栏收起（或预览模式）时，对话区放宽到 `clamp(760px, 68vw, 1280px)` 并居中。
- **模型切换按钮微调**：下拉按钮改为贴住输入框正上方左侧的圆角胶囊（10.5px 字号 / 999px 圆角 / 轻边框），弱化「工具条」存在感。
- 新增单测 `frontend/tests/ask-layout.test.ts`（折叠偏好解析 / 窄屏默认收起 / 落盘可逆 / 常量契约，共 5 条）。

### 验证（UI 呼吸感补丁追加）

- 前端 vitest **146 passed**（12 个测试文件，新增 `ask-layout.test.ts`）；`tsc --noEmit` / `next build` / `scripts/verify.ps1` 12 步门禁全绿。
- `node scripts/health-check-ui.mjs --live` 12 组 UI 断言全绿：1600px 默认视图、侧边栏收起 / 持久化 / 展开、气泡 85%、`line-height: 1.8`、模型按钮位于输入框上方左侧、预览无侧边栏宽版、引用默认 3 条 + 展开 6 条、史引 40/60 分屏、窄屏浮层、真实问答自动分屏；浏览器控制台 0 条产品级 error。
- 验收截图归档 `docs/images/v1.0.5.2-ui-01..06-*.png`。

### 变更（布局与侧边栏修复补丁 · 2026-11-25 同版追加）

> 针对「整页跟随滚动 + 点击历史记录被弹到列表顶部」的体验问题追加的纯前端补丁；不改 API 契约、不改 Agent 能力、不新增依赖。详见 `docs/V1.0.5.2-布局与侧边栏修复补丁.md`。

- **100vh App Shell 三栏布局**：`/ask` 最外层锁死 `100dvh + overflow: hidden`，`html/body` 挂载 `askAppShell` 滚动锁；左侧历史栏 / 中间聊天列表 / 右侧史引面板各自独立滚动（`min-height: 0; overflow-y: auto`），浏览器窗口不再出现整页滚动条。
- **中间聊天区自动滚动**：首屏、切换历史对话、发送新问题、AI 返回新回答时自动滚动到底部；`ResizeObserver` 在史引 40/60 分屏导致列宽变化后补滚到最新消息。
- **左侧侧边栏**：新增悬浮「⋯」菜单（置顶 / 重命名 / 删除）、置顶独立分组、行内重命名（锁定标题）、删除后顺序稳定、固定「+ 新建对话」入口（点击后立即创建新会话并出现在最上方、聊天区回欢迎语）。
- **修复点击重排根因**：历史会话数据层新增 `syncTurns()`（只同步正文、不刷新排序时间），`save()` 仅在新消息落地时刷新 `updatedAt`；`AgentContext` 以 transcript 签名跳过「查看会话」触发的保存——点击一条历史记录只改变高亮，物理位置绝不改变。
- **验收**：`scripts/verify.ps1` 12/12 PASS（pytest 363 / vitest 153）；`health-check-ui.mjs` 默认 22 检查点 / 58 条断言、`--live` 24 检查点 / 63 条断言全绿；截图归档 `docs/images/v1.0.5.2-layout-01..08-*.png`。

---

## [1.0.5.2-仓库基线] - 2026-11-25（原 `[Unreleased]` 段，V1.0.5.3 体检归档）

> 主题：**本机材料整合 + RAG 语料扩展**（v1.0.5.2 开发前的仓库基线；未改外部 API 契约）。

### 新增

- **本机材料整合**：v1.0.5.2 交付文档 `docs/V1.0.5.2-Agent系统提示词与前端功能开发说明.md`（134 KB）入库；WorkBuddy《史脉_历史事件与人物参与表》入库 `docs/sources/`；新增 `docs/README.md` 文档总索引、`docs/开发历程-DSH会话索引.md`（22 个开发会话、2026-11-17 → 2026-11-25）、`docs/整合记录-本机材料归并-20261125.md` 整合记录；历史开发脚本 / 日志 / UI 原型归档 `archive/dev-history/`。
- **RAG 语料第三批 / 第四批**：`docs/史脉_RAG语料库_第三批20篇.md`（19 篇）、`docs/史脉_RAG语料库_第四批20篇.md`（20 篇）；`EXPECTED_DOCUMENT_COUNT` 51 → **90**，入库 chunk 186 → **360**。
- `backend/tests/test_rag_store.py`：RAG store 单测（manifest 校验 / HTTP 客户端 / 检索边界）。

### 变更

- `backend/requirements.txt`：`chromadb` 由 `>=1.5` 固定为 `0.4.24`，新增 `numpy>=1.22.5,<2`（Chroma 1.5.9 在 Windows 触发 SQLite code 14）。
- `backend/rag/store.py`：新增 `create_chroma_client()`，支持 `RAG_CHROMA_HTTP_HOST` / `RAG_CHROMA_HTTP_PORT` 连接 HTTP 服务端。
- `backend/rag/corpus.py`、`backend/scripts/ingest_rag.py`：语料清单与完整性校验同步到 4 份语料 / 90 篇。

### 数据

- RAG 向量库重建：**90 篇 / 360 chunk**，provider `local:BAAI/bge-small-zh-v1.5`（chromadb 0.4.24，持久化目录 `backend/data/chroma_db/`，gitignore 产物）。

### 清理

- 仓库 `.tmp/`（约 2 GB、1.1 万个文件，含 6 份 Edge 浏览器 profile、历史截图与临时脚本）清理；可复用内容归档 `archive/dev-history/`；整合前完整备份（git bundle + 散落材料副本）在 `C:\Users\wiledog\Backup\histolink-20261125\`。
- 桌面「史脉」残留目录（仅余 v1.0.5.2 文档与旧 `.env.example`）在迁入仓库后删除；WorkBuddy 会话目录保留迁移说明文件。

### 验证

- 后端 pytest **318 passed**；`scripts/verify.ps1` 12 步门禁全绿（结果详见整合记录文档）。

---

## [1.0.5.1] - 2026-11-24

> 补丁版本主题：**Agent 对比任务优化 + 对话工作区（Conversation Workspace）UI 重构**。
> 不发布 V1.0.5 之外的版本序列，V1.0.5 保持原状；本版为 V1.0.5 的补丁（tag `v1.0.5.1`）。
> 外部 API 契约不变（`status / answer / evidence / ui_actions / metadata`，三态 `grounded / insufficient / refusal`）；
> 不实现 V1.0.6 多轮对话业务逻辑，只预留 UI 架构。

### V1.0.5.1 Agent：跨朝代对比任务

- **Bad Case 根因**：旧协议每轮只能调 1 个工具，双方实体 ×（定位 → 详情 → RAG）+ final 至少 7 次模型调用，
  必然超过硬上限；且图谱事件标题与问法不一致（问「王安石变法」，图谱标题为「熙宁变法」），
  模型逐轮换词试探进一步耗尽预算，最后一步仍在调工具、来不及 final 而被兜底 `insufficient`。
- **轮次与安全边界**：`MAX_ITERATIONS = 6`（硬上限，外部不可提高）；新增工具调用总数硬上限
  `MAX_TOOL_CALLS = 10`；批量结果总字符预算 `MAX_TOOL_BATCH_RESULT_CHARS = 24000`（单条仍 12000）。
- **新增内部 `action=tool_batch` 协议**：同一轮最多并行执行 **2–4 个彼此独立的只读工具**（线程池），
  结果按模型给出顺序吸收进证据图；仅扩展模型 ↔ 编排器内部协议，不改变外部 API 契约。
- **System Prompt 对比任务专项策略**：识别「对比 / 区别 / 异同 / 有什么不同 / 比较」后按
  「第一轮并行定位 → 第二轮并行取证（双方 `get_event` + 双方 RAG，最多 4 调用）→ 第三轮 final」执行；
  明确「某个名字没命中不要逐轮换词试探」，并新增 claim ↔ evidence ↔ citation 绑定规则
  （RAG claim 必须与同一 `chunk_id` 的 rag evidence 一一对应）。
- **有界收尾轮**：6 个工具轮用尽后追加 **一次**「只收尾」模型调用（禁止工具），
  允许一次 JSON 协议修复重试（`MAX_FINALIZE_RETRIES = 1`）；收尾轮若仍要求工具则安全兜底，不会无限循环。
- **证据校验修复轮**：final 未通过 `EvidenceValidator` 且仍有轮次预算时，把失败原因回传模型重写 final；
  重写结果仍必须通过原校验，**不降低任何证据门槛**。
- **检索效率**：`search_events` 支持「人物名 + 明确事件词后缀（变法 / 改革 / 新政 / 起义 / 之变 / 之战 /
  之乱 / 之役 / 改制）」扩展检索词，「王安石变法」一次命中「熙宁变法」；仅对明确事件词生效，
  「秦始皇 西红柿」等无关问题仍为 0 命中。
- **真实 LLM 复验**：对比问题 **3 轮 grounded**（约 10s，895 字，双方图谱事实 + 3 条 RAG 史料，
  含背景 / 措施 / 影响对比；RAG 年份冲突已标注「史料记载有异」）；单实体查询 2 轮 grounded；
  资料不足 / 越界拒答路径正常；死循环保护、工具异常、证据伪造 / 彩蛋攻击回归全部通过。

### V1.0.5.1 前端：对话工作区（Conversation Workspace）

- **`/ask` 布局重构**：从「单次问答壳层」升级为纵向对话时间线 + 底部输入区的工作区；
  顶部压缩品牌 / 页面名 / 导航；用户问题右对齐、AI 回答左对齐；每轮回答独立状态徽标、可核验来源数、
  引用列表与模型降级提示；桌面端单栏 800px / 分屏 1360px，窄屏单列。
- **长回答显示根因修复**（非临时加高）：去掉 `100dvh + overflow:hidden` 页面壳层与对话列表的嵌套滚动，
  改为**单一页面滚动**；修正 `flex-shrink: 0` 导致长文本把对话列撑出卡片（文字被横向裁切）的问题；
  底部输入区改为文档流内 `position: sticky` 落位，不遮挡 / 不压缩正文；副驾驶面板固定视口高度、
  iframe 内部独立滚动。
- **返回聊天状态根因修复**：`AgentContext` 新增 **sessionStorage 会话持久化**
  （`histolink.agent.transcript.v1`）：首帧欢迎语保证 SSR/CSR 一致（无 hydration mismatch），
  mount 后恢复会话、恢复完成前不回写；`/ask` 重新进入时不再自动弹开旧副驾驶面板；页面级滚动位置
  持久化并区分「用户真实滚动 / 路由复位」，返回聊天后问题、回答、引用与阅读位置都保留。
- **共享 Markdown 渲染器**：新增 `frontend/components/agent/MarkdownMessage.tsx`（+ CSS Module），
  覆盖标题 / 段落 / 粗斜体 / 行内代码 / 列表 / 引用 / 代码块 / 表格（横向滚动容器），
  `/ask` 与悬浮抽屉复用同一实现。
- **V1.0.6 多轮 UI 预留**：对话时间线天然支持多轮延伸；每轮独立回答信息区；底部输入区预留追问位置；
  新增静态布局预览 `/ask?preview=multiturn`（2 轮问答占位，含表格 / 代码块 / 引用 / 两种状态徽标，
  禁用发送并明确标注「不连接多轮业务逻辑」）。
- **测试**：后端 **318 passed**（新增批量工具、结果预算、工具总量上限、收尾轮、校验修复轮、
  对比 Prompt、检索词扩展用例）；前端 **vitest 119 passed**、`tsc --noEmit` 0 error、`next build` 通过；
  Edge headless + CDP 前端验收覆盖真实提问 / 刷新 / 返回聊天 / 超长回答 / 多轮预览 / 桌面与窄屏响应式。
- **版本号统一 V1.0.5.1**：`frontend/package.json` / 首页 / 图谱 / 时间轴 / 浏览器标题 / Agent 抽屉 /
  FastAPI `APP_VERSION` / `contracts.models.API_VERSION`；契约导出物与前端类型同步重建。

### 文档

- 新增 [`docs/V1.0.5.1-Agent对比任务与对话工作区设计.md`](docs/V1.0.5.1-Agent对比任务与对话工作区设计.md)
  （Bad Case 根因、并行协议与安全边界、对比 Prompt、长回答 / 返回聊天根因与修复、V1.0.6 预留边界、验收数据）。
- 新增验收截图 `docs/images/v1.0.5.1-*.png`（真实回答 / 返回聊天 / 超长回答 / 多轮预览 / 窄屏）。

---

## [1.0.5] - 2026-11-24

### V1.0.5 RAG 史料检索与混合架构

- **新增 `backend/rag/`（RAG 数据层）**：
  - `corpus.py`：按 `## 事件名` 解析两份 WorkBuddy 语料（21 + 30 = **51 篇**），抽取
    白话文 / 古文原典、`source`（史记等）/ `source_label` / `record_type`（正史 / 传说）/
    纪年区间，并把事件名对齐到图谱 `event_id`；切分为 **≤500 字**（目标 300–500 字）的 chunk，
    共 **186 chunk**（白话 89 + 古文摘录 97，传说 2）。
  - `embedding.py`：embedding provider 链 —— ModelScope OpenAI 兼容 `/embeddings`（首选，
    当前账号推理 API 未开放 embedding 模型，探测后自动降级）→ 本地 `fastembed` ONNX
    `BAAI/bge-small-zh-v1.5`（512 维，CPU 推理，无需 torch）→ 纯 Python 字符 n-gram 哈希兜底；
    provider / model / dim 写进 manifest，检索端严格按 manifest 重建，避免向量空间错配。
  - `store.py`：`backend/data/chroma_db/` 持久化 chromadb（collection `histolink_rag_v1`，
    cosine 距离）+ 检索入口（≤3 条 / 每条 ≤300 字）+ manifest 状态。
- **新增入库脚本 `backend/scripts/ingest_rag.py`**：解析 → 切分 → 向量化 → 写库 → 写 manifest
  → 库内自检检索（商鞅变法 / 赤壁之战 / 黄帝战蚩尤）；支持 `--dry-run` / `--stats` / `--provider`。
- **新增第 9 个只读工具 `search_historical_text(query, top_k≤3)`**
  （`backend/agent/tools/rag.py`）：返回 chunk 正文 + 元数据（event_name / record_type / section /
  source / event_id / year 区间 / score）+ 统一 `citations`；**单次最多 3 条、每条正文最多 300 字**；
  空结果 `ok=true,total=0`，向量库未就绪返回 `INSUFFICIENT_EVIDENCE` 失败信封。
- **契约（V1.0 只增可选值，不破坏既有调用方）**：`Citation.kind` 新增 `rag`、
  新增可选 `record_type`（正史 / 传说）；`tools-v1.schema.json` 扩到 **9 个工具**；
  `api-v1.openapi.json` 重新导出、`frontend/lib/api-types.ts` 重新生成。
- **Agent 图谱 + RAG 混合路由**（`prompts.py` / `schemas.py` / `validator.py` / `orchestrator.py`）：
  - System Prompt：图谱先取「基础事实」→ RAG 组合查询（用户问题 + 图谱实体/年份）→
    冲突以图谱为准 → 传说 `[传说]` → 图谱与 RAG 双空必须 `insufficient`；注入 RAG 向量库状态。
  - `EvidenceKind` 新增 `rag`（`evidence.entity_id` = chunk_id = citation id）。
  - **轮次硬上限 4 → 6**：混合路由（图谱 1–2 轮 + RAG 1 轮 + final）外加 JSON 修复轮；
    Prompt 增加 `claims ≤3 / evidence ≤4` 长度硬约束（实测 Qwen 在长史料下曾输出 100+ 条 claims
    导致 JSON 被 `max_tokens` 截断，修复轮提示同步要求输出最短 JSON）。
  - **延迟与可靠性**：后端启动时守护线程**预热 RAG 向量库**（首个 RAG 问题不再承担 ~10s 冷启动）；
    Next dev 同源代理 `experimental.proxyTimeout` 30s → **120s**（否则首个混合回答会被代理
    ECONNRESET，前端看到 500）；Prompt 增加「相关性 > 实体命中 / 无直接记载必须 insufficient」，
    修复「秦始皇吃过西红柿吗」被「秦始皇统一六国 + 张骞通西域」旁证凑成 grounded 的问题。
  - `EvidenceValidator`：grounded 正文由服务端按 **① 基础事实（来自图谱）** /
    **② 史料记载细节（来自 RAG）** 分节生成；RAG 年份区间与图谱纪年冲突时标注
    「史料记载有异……以图谱为准」；传说 chunk 句首强制 `[传说]`；无 RAG 证据时正文与 V1.0.4 一致。
- **版本号统一 V1.0.5**：`frontend/package.json` / 首页 / 图谱 / 时间轴 / 浏览器标题 /
  Agent 抽屉 / FastAPI `APP_VERSION` / `contracts.models.API_VERSION`。
- **测试**：后端 **269 → 292 passed**（新增 `test_rag_corpus` 10 条、`test_tools_rag` 9 条、
  `test_agent_rag_routing` 3 条、工具注册表 RAG 参数 1 条）；契约导出 / 前端类型生成 / 契约校验同步更新。
- **数据产物**：`backend/data/chroma_db/`（chroma 持久化 + `manifest.json`，**已 gitignore**，
  重建命令 `backend\.venv\Scripts\python backend\scripts\ingest_rag.py`）。
- **文档**：新增 [`docs/V1.0.5-RAG混合检索设计.md`](docs/V1.0.5-RAG混合检索设计.md)（架构、数据口径、
  混合路由、冲突处理、Token 控制、验收命令与实测结果）。

### V1.0.5 高可用补丁：LLM 自动降级（2026-11-24）

- **配置**：`MODELSCOPE_FALLBACK_MODEL`（默认 `Qwen/Qwen3.5-8B-Instruct`）由
  `backend/llm_client.py` 的 `load_llm_settings()` 读取（本项目无独立 `config.py`，LLM 配置统一在此处）；
  与主模型同名时自动禁用降级，避免重复打同一个已限流模型。`backend/.env.example` 同步补充说明。
- **自动降级**：`LLMClient.chat()` 主模型遇到 **HTTP 429 / 502 / 504** 或 `httpx.TimeoutException`
  时记录 warning 日志，并自动切换备用轻量模型**重试一次**；其它错误（400/401/302/500/503）不降级；
  备用模型也失败时才抛出 `LLM_UPSTREAM_ERROR` / `LLM_TIMEOUT`（消息带「已降级重试，仍失败」上下文）。
- **可观测**：`LLMChatResult.model_used` → `AgentResult.model_used` → API `trace.model_used`
  （V1.0 只增可选字段，向后兼容）；前端抽屉与 `/ask` 在最终模型不是 35B 时于回答下方显示灰字
  「当前网络繁忙，史令已切换至轻量模型回答」。
- **测试**：后端 **292 → 306 passed**（新增降级单测：429/502/504/超时自动切换、401/500/503 不降级、
  备用模型也失败、主备同名禁用、配置默认值 / 覆盖，以及 API `trace.model_used` 贯通用例）。

---

## [1.0.4] - 2026-11-24

### V1.0.4 前端 Agent 数据层

- **新增 `frontend/contexts/AgentContext.tsx`**：全局 Agent 状态（单一会话事实源）。`ask(question)`
  组装页面上下文 + 最近 10 轮 history → `POST /api/agent/ask`（Next 同源代理）→ 写入 transcript；
  错误信封 / 网络异常统一转为 assistant 错误 turn；对外提供 `isAsking` / `lastAnswer` /
  `pendingActions` / `confirmAction` / `cancelAction`。
- **ActionBus 升级（`frontend/lib/action-bus.ts`）**：保留 V1.0.1 的注册 / 幂等 / 同页自动 / 跨页确认，
  新增 `dispatchAll` 与确认后跨页导航（`navigate` + `resolveHref`）；新增 `createAgentActionBus` 工厂。
- **新增 `frontend/lib/agent-client.ts` / `action-navigation.ts`**：请求组装、信封归一化、
  fetch 错误映射、动作 → 深链接（focus_event / focus_dynasty / focus_person / focus_relation / ask.suggest）。
- **Timeline / Graph 联动**：AgentContext 把 `ui_actions` 交给 ActionBus；同页 `timeline.focus_event`
  自动切朝代 / 选中事件并回写深链接，`graph.focus_person` / `focus_relation` 自动换中心 / 打开关系面板；
  跨页动作在抽屉显示「前往 / 取消」，确认后跳转目标深链接。
- **动作 id 跨轮隔离**：服务端动作 id 每轮可能复用（如 `act-1`），前端统一加 `request_id:` 前缀再分发。
- **测试**：前端 66 → **99 passed**（新增 `agent-client` 19 条、`action-navigation` 7 条、
  ActionBus 导航 / 批量 7 条、timeline group 深链接 1 条）；`pnpm exec tsc --noEmit` 与 `pnpm build` 通过。
- **文档**：新增 `docs/V1.0.4-Agent-UI数据层设计.md`（调用链 + 手工验收步骤）；
  `docs/V1.0.7-TODO.md` 记录 ruff 格式 / lint 存量告警与 `httpx2` 弃用警告。

### V1.0.4 收尾修复（分屏联调体验 / 联动 / 响应式 / 顶部压缩）

- **P1 推荐问题改为单跳简单事实**：`/ask` 推荐位从「刘邦和项羽身边有哪些共同人物？」这类多跳图
  交叉查询，换成 3 个单轮工具即可回答的库内事实题（赤壁之战年份 / 玄武门之变年份 / 武则天所属朝代），
  避免「推荐问题一点就报错 / 资料不足」。
- **P2 史引副驾驶自动展开**：新增 `frontend/lib/agent-guide.ts`（`resolveGuideFromTranscript`），
  `AgentContext` 暴露 `guide`；`/ask` 在回答的 `ui_actions` 含 `timeline.focus_event` /
  `timeline.focus_dynasty` / `graph.focus_person` / `graph.focus_relation`（或 grounded 回答自带
  可定位引用）时**自动展开**右侧面板，无需再点按钮。根因修复：`hrefForAction` 合并 `payload` 与
  `target.params`（模型可能只写其中一处，后端 required 字段校验本就是合并判断），时间轴 / 图谱的
  ActionBus handler 同步同一口径。
- **P3 时间轴半屏响应式**：轨道按 680px 设计宽度布局，容器更窄时整体 `scale` 等比缩放并同步视口高度；
  轨道视口改为 `overflow: hidden`，副驾驶半屏里不再出现横向滚动条，错层与横坐标按同一比例缩放。
  副驾驶 iframe（`data-embed`）内同时压缩页头，把高度让给轨道。
- **P4 顶部空间压缩**：删除 `/ask` 中部「史脉问答 / 史令查阅 · 史引联动」标题块与推荐卡里的
  「可以从这里开始」；品牌「史脉问答」+ 印章图标常驻顶部导航栏（`SHIMAI · CONSOLE`），推荐问题
  改为一行 chip，聊天列表获得更多高度；`/ask` 隐藏全局悬浮球，避免压住右侧副驾驶面板。
- **跨期人物深链接**：`resolveGraphDeepLink` 在未显式给 `era` / `group` 时跨 18 期 / 7 组查找 `person`，
  修复「引用 / 副驾驶跳关系图却落回默认中心（孔子）」的问题。
- **测试**：新增 `frontend/tests/agent-guide.test.ts`（9 条）与深链接跨期、`target.params` 兜底用例，
  前端单测 **99 → 110**。

---

## [1.0.3] - 2026-11-23

### 新增与安全加固

- **V1.0.3 Agent Core（2026-11-23）**：新增 `backend/agent/{schemas,prompts,tool_registry,orchestrator,validator}.py`，
  实现问答核心循环「System Prompt（纯 JSON 协议）→ Qwen（`enable_thinking=false` + JSON 模式）→
  工具白名单 + 严格 Pydantic 参数校验 → 工具执行 → 证据校验 → `AnswerEnvelope`」。
  - `AgentOrchestrator` 最多 4 轮，防死循环；模型 JSON 解析失败自动修复重试，轮次耗尽兜底 `insufficient`；
  - `EvidenceValidator` 最高优先级：`evidence.entity_id` / `claims[].citation_ids` 必须命中本轮工具真实返回，
    否则强制降级 `insufficient`（API 仍 200，`missing` 说明原因）；
  - `tool_registry.py` 不把模型原始 dict 直接传给 Python：8 个工具各有 `extra="forbid"` + `strict=True`
    的参数模型，未知工具 / 多余字段 / 类型漂移全部拒绝；
  - 新增 `POST /api/agent/ask`（唯一写入口；其余 `/api` 写方法仍 405），`llm_client.chat()` 支持顶层
    `enable_thinking=false`、`response_format=json_object`、超时/上游错误映射；
  - 新增 69 条 pytest（三态 schema / 工具注册表 / 证据校验 / 多轮循环 / JSON 修复 / LLM chat / API 三态与错误码），
    后端全量 149 → **218 passed**；新增设计文档 `docs/V1.0.3-Agent-Core设计.md`。
- **V1.0.3 安全加固（2026-11-23，回应《V1.0.3 Agent Core 核心代码审查报告》）**：
  - **P0-1 证据图校验**：`ObservedEvidence` 从 `set[str]` 升级为带类型 / 来源 / 出现形态 / 事实可用性 /
    citation 绑定的证据图；evidence 必须类型一致、有事实详情（排除 `*_ids` 列表里的裸 ID）、
    `fact_usable=true`，并与 claim 的 citation 绑定到同一事件 / 人物 / 关系；彩蛋事件、
    `is_special`、`source_status=easter_egg` 一律不可作为证据；`related_event_ids` 只接受事件 ID；
  - **P0-2 服务端重写**：grounded 的 `claims[].text` 与 `markdown` 不再信任模型文本，改由服务端用
    工具真实返回的 citation / 实体详情生成；提示词注入无法把工具中不存在的内容带进最终回答；
  - **P0-3 全模式服务端文案**：新增 `ModelAnswer`（模型协议，移除 `certainty`、自由 `missing` 改为
    枚举 `missing_reasons`）与 `FinalAnswer`（服务端输出）。`insufficient` 使用固定模板
    `抱歉，现有的历史数据无法完整回答您的问题。缺少的信息：…`，`refusal` 按 `reason_code`
    使用绝对固定文案；`certainty` 由服务端写死（grounded high/medium、insufficient low、refusal null）。
    模型在所有模式下提供的 `markdown` 均被完全废弃；`ObservedEvidence.absorb()` 增加最前置
    `ok is not True` 判断，失败信封即使被篡改出 citations 也不会进入证据图；
  - **P1-1**：`max_steps` 硬上限收紧为 4；**P1-2**：UI Action 校验 `person_id_a/b`、动作类型与
    `target.surface` 匹配、最多 3 个、降级 / 拒答 / 资料不足统一清空；**P1-3**：工具内部异常统一转
    `INTERNAL` 安全信封，API 边界兜底 500 envelope；**P1-4**：模型响应必须是完整且唯一的 JSON 对象；
    **P1-5**：LLM 请求禁止自动跟随重定向；
  - **放行后清理（架构师非阻断建议）**：`ModelAnswer` 移除 `markdown` 与 `claims[].text`
    （新增 `ModelClaim`：仅 `id + citation_ids`）；新增 `ModelUIAction`（模型不提供 `label`），
    `label` 由服务端 `ACTION_LABEL` 按 `action.type` 写死；模型协议中已不存在任何用户可见文本字段。
    ruff 格式 / lint 存量告警与 `httpx2` 弃用警告列为后续处理项；
  - 新增 `tests/test_evidence_security.py`、`tests/test_agent_prompt_injection.py` 及 P1 / P0-3 / 清理回归用例，
    后端全量 **269 passed**（新增 51 条安全 / 回归测试）。

### 后续规划

- V1.0.4 动作联动、V1.0.5 检索与引用校验、V1.1 终极 UI

---

## [1.0.2] - 2026-11-23

> 版本主题：**Agent 工具层**（审核报告 §9.1 的 8 个只读工具可执行实现 + 工具契约测试；tag `v1.0.2`）。

- **新增工具层**：`backend/agent/tools/` 实现 `resolve_entity` / `search_events` / `get_event` /
  `get_person` / `get_person_events` / `get_relation` / `get_era_graph` / `timeline_span`。
  工具直接读内存 `SnapshotStore`，不发 HTTP、不写盘；`ToolContext` 预建关系对 / 人物事件 /
  时期图索引；空结果与错误语义明确（`total=0` / `ENTITY_NOT_FOUND` / `INVALID_REQUEST`）。
- **统一返回信封**：`ok/tool/items/citations/truncated/snapshot_version/data/error/meta`；
  产品批复后 `contracts/tools.py` 的 `output` 同步升级为信封（成功 / 失败 `oneOf`，工具专属出参
  保留在 `data`），`contracts/tools-v1.schema.json` 已重新导出并纳入 `--check`。
  `contracts.models.ToolResult` 只新增可选字段，不破坏 V1.0.1 调用方。
- **测试**：新增 62 条 pytest（真实快照，覆盖正常 / 空结果 / 歧义 / 彩蛋排除 / 负年份 /
  非法参数 / 统一信封与冻结 Schema 校验），后端全量 87 → **149 passed**。
- **文档**：新增 `docs/V1.0.2-工具层设计.md`（工具口径、返回示例、批复落地）。

---

## [1.0.1] - 2026-11-23

> 版本主题：**Agent 前置基建纵切片**（《V1.0.1-任务卡拆解》TC-01~TC-11 全部完成，tag `v1.0.1`）。
> 依据：[docs/V1.0-项目现状与开发前置审核报告.md](docs/V1.0-项目现状与开发前置审核报告.md) Q1–Q6 决策。
> 本版**不交付**规划器 / 真实问答 / BM25 检索 / 多轮记忆；只交付可被后续版本依赖的基座。

### 追加（TC-10 模型能力实测，2026-11-23）

- **新增 LLM Client**（`backend/llm_client.py`）：从 `backend/.env` / 环境变量读取
  `MODELSCOPE_API_KEY` / `MODELSCOPE_BASE_URL` / `MODELSCOPE_MODEL`（兼容 `LLM_*` / `OPENAI_*` 别名），
  调用 OpenAI 兼容 `/chat/completions`；超时、401/429/5xx、非法 JSON、缺 content 均映射为明确异常，
  错误信息对 key 做脱敏；密钥不写日志、不回显。
- **新增连通性端点** `GET /api/agent/ping_llm?message=请回复 OK`：返回模型真实回复 / 模型名 / 耗时 / token 用量；
  未配置 → 503 `LLM_NOT_CONFIGURED`，上游错误 → 502 `LLM_UPSTREAM_ERROR`，超时 → 504 `LLM_TIMEOUT`；
  支持 `ENABLE_LLM_PROBE=0` 关闭（公网分享时防额度消耗）。
- **新增独立探针** `backend/scripts/spike_llm.py`（不启动服务即可验证 key/URL/模型名）与
  `backend/.env.example` 模板；新增 `docs/spikes/`（复现说明 + 能力报告）。
- **真实连通性 PASS**：实测 `Qwen/Qwen3.5-35B-A3B`。4 次重复调用回复均为 `OK`，
  total_tokens 174–184（思考模式基线 251，与用户实测 248 同一量级），延迟 2335–2764ms；
  `/api/agent/ping_llm` 真实返回 `usage.total_tokens=175` / `latency_ms=2441`。
- **其余能力**：JSON 模式 PASS（218 tokens / 3.35s，可解析）；tool calling PASS（1 个 `get_event` 调用，
  参数 `{"event_id":"qin-unify"}`）；SSE PASS（首字 515ms）；中文回答 PASS（思考模式 212 字 / 68.7s、关闭思考
  184 字 / 2.36s，均带《史记》出处）；确定性 PASS（4/4 回复一致）。
- **关键发现**：模型默认开启思考，`max_tokens` **不限制 reasoning tokens**（`max_tokens=400` 实测
  6281 completion tokens）；顶层 `enable_thinking=false` 生效（16 tokens / 732ms）。
  V1.0.3 路线定为 **tool calling 为主 + JSON 兜底**，意图抽取默认关闭思考，长文解释按需开启并把超时提到 90–120s。
- **契约同步**：`PingLLMResponse` 进入 OpenAPI（8 条路径）、新增 ping 样例；前端类型重新生成；
  后端测试 59 → **87 passed**（新增 LLM Client 与端点离线测试，不访问网络）。
- **清理**：`main.py` 补全 `lifespan` / `enforce_read_only` 类型标注并移除 `# type: ignore`；
  `ruff --select F,E9` 无未使用导入。

### 新增

- **TC-01 基线冻结与门禁**：提交 `chore(release): freeze v0.9.0 baseline` 并打轻量 tag `v0.9.0`；新增 `scripts/verify.ps1`（10 步本地权威门禁）与 `.github/workflows/ci.yml`（前端 tsc/build/validate-data + 后端 compile/pytest）。
- **TC-02 人物主数据与消歧**：`scripts/build-persons.mjs` 生成 **1,058 条** person 记录（1,059 个姓名 − 3 条异名同一人合并 + 2 条同名拆分：梁太后东汉/西夏、刘崇西汉/五代）；稳定 ID `p-<romanized>[-<tag>]-<4位hash>` + `person-ids.lock.json` 锁文件；66 条全局别名按 `person_id` 归一；`person-overrides.ts` 为唯一人工裁决层；新增同名报告与 `--check` 门禁。
- **TC-03 引用结构化**：从 705 条事件简述抽取 **823 条**结构化引用（585 条 1 书 + 119 条 2 书），彩蛋 `special-star-1893` 显式空引用 + `easter_egg`；新增 `event-sources.ts`、共享解析器 `scripts/lib/parse-sources.mjs`、`docs/source-review.md`（191 个标签 / 29 种书目 / 裴注引与尾注例外 / 关系引用派生规则）。
- **TC-04 三份契约冻结**：`backend/contracts` 为唯一 Pydantic 事实源（请求/回答/错误/澄清/动作/工具/只读数据接口）；导出 OpenAPI 3.1（`info.version=1.0`）、actions/tools JSON Schema；人工维护 `action-policy.json` 并做覆盖校验；前端类型由 `openapi-typescript` 生成；32 条后端契约测试 + Node 契约测试 + 5 份样例。
- **TC-05 数据快照**：`scripts/export-snapshot.mjs` 产出前后端同源 `snapshot.v1.json`（705 事件 / 1,058 人物 / 639 关系 / 18 期 / 7 断代 / 7 分组 / 66 别名，2.73MB）+ `snapshot.meta.json`（内容寻址版本、sha256 content_hash）+ `event-ids.lock.json`；`--check` 保证可重复生成。
- **TC-06 后端只读 API**：`main.py` 改为 `create_app()` + lifespan 加载快照（hash/counts/许可校验失败即拒绝启动）；新增 `/api/health`、`/api/meta`、`/api/entities/person|event|persons`；统一错误 envelope（400/404/405/503/500）与 `/api` 只读闸门；59 条后端测试（契约 / 实体 / 错误 / 快照 fail-fast）。
- **TC-07 AppShell 与 ActionBus 骨架**：`layout` 挂 `AgentProvider`（单一会话）+ 全局悬浮抽屉 + `/ask` 独立页（ESC / 遮罩关闭、基础 a11y、不请求后端）；新增 `lib/action-policy.ts`（Q2 策略：同页自动 / 跨页确认 / 未知类型忽略 / 缺 surface 视为跨页）、`lib/action-bus.ts`（注册 / 分发 / 幂等键 / 待确认队列）、`lib/routes.ts`（深链接构造器）；vitest 30 条单测。
- **TC-08 组件受控接口与深链接**：`PersonGraph2D` 新增可选 `highlightedPersonIds` / `selectedPersonId` / `onPersonSelect`（`undefined` = 非受控，默认行为与 V0.9.0 完全一致；非法 / 非邻居 / 中心自己安全降级）；受控状态变化只更新 SVG class / aria，不重跑力导向；新增 `lib/graph-selection.ts`（纯函数可单测）。`ActionBus.register` 返回注销函数，`/timeline` 注册 `timeline.focus_event` / `timeline.focus_dynasty`、`/graph` 注册 `graph.focus_person` / `graph.focus_relation`，执行后回写 URL。新增 `lib/deep-links.ts`：`/timeline?event=&dynasty=&mode=`、`/graph?person=<person_id|姓名|别名>&era=<era|scope>&mode=&selected=` 可恢复视图（`selected` 驱动受控关系面板）；彩蛋事件打开彩蛋、非法参数安全回落。新增 `lib/action-capabilities.ts`（动作 → 表面 → 组件能力 → 归属版本）、`docs/component-capability-map.md`、能力映射 / 受控选中 / 深链接单测。
- **TC-09 评测骨架**：新增 `evals/golden.v1.json`（**30 条**用例，12 类覆盖：公元前年份 3 / 同名歧义 4 / 资料不足 3 / 跨朝代 3 / 关系 4 / 对比 3 / 超范围 2 / 彩蛋排除 1 / 仅图谱事件 1 / 多轮承接 2 / 事件人物联动 2 / UI 动作策略 2）、`evals/schema.json`（draft 2020-12）、`evals/README.md`、`scripts/run-evals.mjs`。contract 模式校验 schema、快照 version/hash/counts 绑定、person/event/era 0 悬空、工具入参满足 tools schema、动作 available + surface/同页判定、回答模式与 missing/reason_code/clarification 自洽、引用必须来自有据事件、彩蛋不得作事实，并内置**负向自测**（篡改 ID 必须被拦截）。已接入 `scripts/verify.ps1` 第 11 步。
- **TC-11 出口门禁与发布**：版本文档统一推进到 **1.0.1**（`frontend/package.json` / 首页 / 图谱 / 时间轴 / 标题 / FastAPI `APP_VERSION`）；`scripts/verify.ps1` **12 步全绿**；新增 `docs/V1.0.1-验收记录.md`；打 tag `v1.0.1`。

### 数据

- 快照 `v1-2978ceda7d15`，`content_hash=sha256:5b89c7e0…d06b`，大小 2,862,384 bytes。
- 事件 705（时间轴 671 + 图谱补足 34）；人物 1,058（见 TC-02 偏差说明）；关系 639；细览 18 期 / 简阅 7 组 / 7 大断代；别名 66。

### 验证

- `pwsh scripts/verify.ps1` **12 步全绿**（tsc / next build / validate-data / build-persons / extract-sources / export_contracts / gen-frontend-types / export-snapshot / pytest / vitest / run-evals-contract / validate-contract），总耗时约 17 秒。
- 后端 pytest **87 passed**；前端 vitest **66 passed**；评测 contract **30/30**；`next build` 含 `/ask`、`/timeline`、`/graph` 静态预渲染通过。
- Edge headless + CDP 手工验收：三页抽屉可开关、ESC 可关、`/ask?q=test` 显示问题、抽屉与 `/ask` 会话共享、首页「聊天问答」入口保持封印、无 hydration 报错；深链接 `/timeline?event=qin-unify`、`/graph?person=…&era=qing`、`/graph?person=曹操&era=sanguo&selected=刘备` 均可恢复视图，受控选中打开关系面板（截图见 `docs/images/v1.0.1-deeplink-*.png`）。
- 模型实测：`Qwen/Qwen3.5-35B-A3B` 连通性 / JSON / tool calling / SSE / 中文 / 确定性全部通过（详见 `docs/spikes/`）。

### 文档

- 新增 `docs/person-same-name-report.md`、`docs/source-review.md`、`contracts/README.md`、`backend/data/README.md`、`docs/V1.0.1-验收记录-纵切片.md`、`docs/V1.0.1-验收记录.md`、`docs/component-capability-map.md`、`evals/README.md`、`docs/spikes/README.md`、`docs/spikes/modelscope-qwen3.5-35b-a3b-capability.md`；README 增补只读 API 列表、门禁命令、目录结构、受控接口 / 深链接 / 评测骨架与限制说明；SPEC 新增 §7.17–§7.19。

### 已知偏差（保留记录）

- 人物记录 **1,058** 而非任务卡预期的 1,061：额外发现 3 组「别名本身也是事件参与者姓名」（明武宗/朱厚照、明神宗/万历帝、宋恭帝/赵㬎），按别名表合并为同一人，已在同名报告中逐条裁决；若保持 1,059 个姓名为 1,059 条记录，会让同一历史人物拿到两个 `person_id`。
- 书目标签 **191** 而非任务卡记录的 185：任务卡仅统计括注首个书目，本实现把并列书目的第二本也视为独立标签；引用条目 823 与任务卡一致（裴注引按 1 条计）。
- 只读 API 的 405 由中间件统一拦截（无路由的写方法也返回 envelope），错误码新增 `INVALID_REQUEST` / `METHOD_NOT_ALLOWED` / `ROUTE_NOT_FOUND` / `SNAPSHOT_NOT_LOADED` 四个 API 层枚举值。
- `vitest.config.ts` 的 CJS 告警已在 V1.0.1 出口前改名为 `vitest.config.mts` 消除（vitest 自动识别）。
- 受控接口的 `selectedPersonId` / `onPersonSelect` 参数当前为图节点 id（姓名）；`person_id` 迁移随关系库在 V1.1 完成。

---

## [0.9.0] - 2026-11-21

> 版本主题：**内测版封装与部署准备**——功能冻结，只做 UI 封印与运行环境加固，为通过 UUMit / 局域网分享给朋友测试做准备。

### 新增

- **首页「聊天问答」入口封印**（`frontend/app/page.tsx` + `globals.css`）：
  - 入口置灰 + 虚线边框 +「开发中」小标签，副文案改为「Agent 智能问答 · 敬请期待」；
  - 点击**不跳转任何路由**，只弹出 Toast「Agent 智能问答模块正在闭关开发中，敬请期待！」；
  - 设置 `aria-disabled` / `title` / `aria-describedby`，键盘与读屏可感知「暂不可用」；
  - 「时间轴」「人物关系图」两个入口与右下角后端连通角标逻辑保持不变。
- **`/api` 同源代理**（`frontend/next.config.ts`）：`/api/*` → `API_PROXY_TARGET`（默认 `http://127.0.0.1:8000`）。浏览器只访问前端端口，分享时无需暴露 8000，同时避免 CORS 与 HTTPS 页面下的 Mixed Content 问题。
- **局域网脚本**：`frontend/package.json` 新增 `dev:lan` / `start:lan`（`next dev|start -H 0.0.0.0 -p 3000`）。
- **dev 模式跨域放行**：`next.config.ts` 自动收集本机全部非回环 IPv4，并默认放行 UUMit 隧道域名（`**.uua2a.com` / `**.uumit.com`）写入 `allowedDevOrigins`，局域网与 UUMit dev 分享零配置即可正常水合；其他隧道域名可通过 `ALLOWED_DEV_ORIGINS`（逗号分隔 hostname）追加。修复了 Next 16 在 dev 模式下拦截非 localhost 主机 `/_next` 请求、导致朋友访问时页面不水合的问题。
- **README §4.7「分享给局域网 / 公网测试」**：局域网取 IP 与防火墙放行、UUMit 应用网关步骤（`npx @uumit-ai/uumit share 3000` / `uumit-connector share 3000`、限时分享链接、防止电脑睡眠）、CORS / 代理变量速查。

### 变更

- **全局版本号 V0.9.0（内测版）**：`frontend/package.json`、首页版本徽标、`/graph` 版本标识、`layout.tsx` 标题与描述、`backend/main.py` 的 `APP_VERSION`。
- **健康检查改为同源相对路径** `/api/health`（`NEXT_PUBLIC_API_BASE` 仍可覆盖为直连后端）；`/api/health` 响应增加 `version` 字段，返回 `{"ok": true, "version": "0.9.0"}`。
- **后端 CORS 环境变量化**：`ALLOW_ORIGINS`（逗号分隔，默认本机 3000）与 `ALLOW_ORIGIN_REGEX`（默认放行 `localhost` / `127.0.0.1` / `10.x` / `192.168.x` / `172.16–31.x` 任意端口，置空可关闭）；朋友 IP 不同无需改代码。

### 修复

- **分享场景下健康角标误报**：原实现硬编码 `http://localhost:8000`，朋友通过局域网 IP / UUMit 域名访问时，`localhost` 会解析成朋友自己的电脑，角标恒为「后端未连接」。改为同源代理后恢复正常。

### 文档

- `README.md`：版本号、已实现功能表、目录结构、快速开始（4.3 / 4.6 / 新增 4.7）、路线图（V0.8.2.1 / V0.8.2.2 归档、V0.9.0 当前版本）、已知限制（内测无鉴权、后端仅健康检查）、近期更新日志。
- `SPEC.md`：新增 §7.16「内测版封装（V0.9.0）」。
- `CHANGELOG.md`：新增本版记录。

### 验证

- **类型检查**：`tsc --noEmit` **0 error**。
- **构建**：`next build` 通过，`/`、`/timeline`、`/graph` 全部预渲染。
- **浏览器实测（Edge + CDP）**：分别用生产模式（`next start`）与 dev 模式、经 `127.0.0.1` 与局域网 IP 访问，首页「聊天问答」点击后 URL 不变、Toast 文案正确、`aria-disabled="true"`；「时间轴」「人物关系图」跳转正常；`/api/health` 经同源代理返回 `{"ok": true, "version": "0.9.0"}`，角标显示「后端已连接」；控制台 0 error。dev 模式未放行局域网 IP 时曾复现「页面不水合」，加入自动放行后恢复。
- **CORS 实测**：带 `Origin: http://192.168.1.50:3000` 请求返回 `access-control-allow-origin`；非白名单公网 Origin 不回显。

---

## [0.8.2.2] - 2026-11-21

V0.8.2.2 新增时间轴特殊节点及致敬横幅（隐藏彩蛋）

---

## [0.8.2.1] - 2026-11-20

> 版本主题：**修复图谱分期串期**——秦汉图不再收录汉末群雄（188 起）事件，曹操、刘备、孙权、吕布等三国人物彻底移出秦汉图；三国图补齐全量汉末前史；全部分期加装隔离校验。

### 修复

- **秦汉 / 三国串期**：`/graph` 切到「秦汉」时中心人物显示曹操、周围全是三国 / 汉末人物（刘备、孙权、孙策、吕布等），而左侧名人堂仍是秦汉配置（秦始皇、刘邦），两者脱节。
  - 根因一：秦汉图按 `dynasty === "东汉"` 收录东汉全期事件，而讨董（189）、官渡（200）、赤壁（208）、襄樊（219）等汉末事件的参与者正是三国人物。
  - 根因二：切期时「中心人物在目标图存在则保留」，曹操同时存在于旧秦汉图，于是被保留，造成「秦汉名人堂 + 三国中心」。
- **修复口径（按年份切分，时间轴口径不变）**：
  - 秦汉图 = 秦 + 西汉 + 东汉 **184 年及以前**（黄巾起义；保留张衡、蔡伦、党锢、熹平石经等东汉人物）；
  - 三国图 = 全部三国事件 + 东汉 **188 年及以后**的汉末群雄事件（讨董—襄樊，作为三国前史）。
- **名人堂与中心同步**：默认中心人物必须在该期 `KEY_FIGURES` 名人堂池内；跨期人物（杨坚 南北朝↔隋、赵匡胤 五代↔北宋）的保留行为不变，但不再可能保留到不含该人物的分期。
- **跨期人物清洗**：清理 9 条既有事件中「晚于卒年仍参与事件」的跨期人物——陈桥兵变去柴荣（补赵普 / 赵光义 / 石守信）、灭后晋去耶律阿保机、金灭辽去完颜阿骨打、蒙古灭金与建元去成吉思汗（建元补刘秉忠）、靖难去朱元璋、皇太极改国号去努尔哈赤（补范文程）、清军入关去皇太极（补吴三桂）、灭后梁去朱温；相关关系简述迁移到两人仍共同参与的事件。
- **纪年笔误校正**：校正 13 条 V0.8.2 自撰事件的年份笔误（朱友珪弑父 912、包拯知开封 1052、张邦昌伪楚 1127、卫绍王立 1208、金哀宗即位 1224、播州之役 1600、罗卜藏丹津 1724、盗宋陵 1285、辽穆宗遇弑 969、仁寿宫成 595、马嵬驿 756、遣唐使 717、奎章阁 1329），事件 id 与既有条目年份均未改动。
- **全分期隔离排查**：补正 `PERSON_GRAPH_ERAS[].dynasties` 与实际事件池一致（南宋含北宋、辽含金、金含南宋、元含金 / 南宋），并新增校验：
  - 每个图谱节点至少有一条事件锚定在该期声明朝代内；
  - 秦汉图禁止曹操 / 刘备 / 孙权 / 孙策 / 吕布 / 董卓 / 袁绍 / 诸葛亮 / 关羽 / 司马懿等三国人物，且节点不得只有 184 年后事件；
  - 三国图禁止刘邦 / 汉武帝 / 秦始皇 / 韩信 / 卫青 / 霍去病 / 张良等秦汉人物，且节点必须有三国或 188 年后事件；
  - 默认中心必须出现在 `KEY_FIGURES` 配置中。

### 数据

- 秦汉图 230 人 / 509 边 → **183 人 / 368 边**；三国图 63 人 / 176 边 → **64 人 / 179 边**（汉末群雄单边归属，不再两图重复计数）。
- 简阅「秦汉 / 三国」同步修正；跨期人物清洗后其余各期小幅调整：北宋 53/113、辽 45/72、金 87/166、元 76/119、明 76/125、清 76/136、五代十国 38/46。关系库 640 → **639 对**（删除「成吉思汗 × 忽必烈」这条已无共同事件的关系），关系随边归属：秦汉图关系覆盖 165 → 27/368（楚汉关系为主），三国图 176/179 近全覆盖。
- 25 张图谱合计 **2276 个节点位 / 4031 条边**、去重人物对 1904 对。

### 文档

- `README.md`：版本号、图谱统计表（秦汉 / 三国）、分期隔离说明、关系覆盖、校验说明、路线图、近期更新日志同步至 V0.8.2.1。
- `SPEC.md`：新增 §7.15「图谱分期隔离规范（V0.8.2.1）」。
- `frontend/package.json`：0.8.2 → **0.8.2.1**；`/graph` 页脚版本号同步。

### 验证

- **类型检查**：`tsc --noEmit` **0 error**。
- **全量数据校验**：`node scripts/validate-data.mjs` → **ALL CHECKS PASSED**（新增「分期隔离」检查全部通过；0 孤儿 / 0 悬空边；640 对关系、64 条别名、23 个名人堂标签组、docs 122 行全部通过）。
- **回归验收**：秦汉默认中心**刘邦**，直接邻居为韩信、项羽、陈平、萧何、吕后、樊哙等楚汉人物；三国默认中心**曹操**，直接邻居为刘备、孙权、袁绍、吕布、关羽、周瑜等；切期不再出现「秦汉名人堂 + 三国中心」。

---

## [0.8.2] - 2026-11-20

> 版本主题：**全朝代数据厚度对齐（纯前端功能版收尾）**——把此前偏薄的宋、辽、西夏、金、元、明、清补齐到与秦汉同级别的数据厚度，并合并 6 份 WorkBuddy 终极数据文件；时间轴渲染与 `PersonGraph2D` 力导向逻辑未改。

### 新增

- **174 条时间轴事件**：元 28 / 清 23 / 明 21 / 北宋 19 / 南宋 18 / 辽 16 / 金 16 / 西夏 10 / 五代十国 7 / 隋 6 / 唐 5 / 南北朝 3 / 西汉 2；时间轴 496 → **670 条**。
- 重要度 `importance: 3` 新增 25 条（共 **136 条**），简阅模式断代大事同步增厚。
- **人物关系库 +179 对**（461 → **640 对**）：新事件内同步校订关系定性、来龙去脉与「人物对—事件」简述，全部通过「两人共同参与该事件」校验。
- 仓库级全量校验脚本 `scripts/validate-data.mjs`：事件字段与 id、时间轴 / 图谱参与者一致性、18 期 + 7 组图谱的节点 / 边 / 权重 / 双向一致性、关系库 pairKey 与共同事件、别名与名人堂、docs 数据文件六层校验，失败以非 0 退出码收尾。
- `docs/01_先秦.md`—`docs/06_元明清.md` 六份终极数据文件并入事件库：**122 行**核心事件逐条语义映射，同题复用既有 id、缺失者补录，参与者按史实并集去重。

### 变更

- **图谱厚度跃升**：宋辽金夏简阅图 67 人 / 88 边 → **205 / 386**；元明清简阅图 58 / 64 → **197 / 337**；金期 7 / 6 → **87 / 170**、元期 13 / 15 → **75 / 120**、明期 27 / 26 → **76 / 126**、清期 24 / 27 → **75 / 137**，与秦汉（230 / 509）对齐到同一量级。
- **分期事件池按同期政权互见重排**：金期读金 + 南宋 + 北宋末四事，辽期补高梁河 / 雍熙北伐 / 澶州之战 / 金灭辽，西夏期补五路伐夏 / 永乐城，南宋期补搜山检海 / 顺昌之战 / 靖康之变，元期补三峰山 / 联蒙灭金 / 襄樊 / 临安降元 / 崖山，清期补萨尔浒 / 己巳之变；时间轴仍保持「一个事件只归一个朝代」。
- **孤儿节点与断边清零**：为 17 条单参与者旧事件补入史实上有据的共事人物（如张衡 × 汉安帝 / 汉顺帝、蔡伦 × 汉和帝、盘庚 × 小辛、屈原 × 楚顷襄王），全部 25 张图谱 0 孤儿、0 悬空边。
- 搜索别名新增 19 条（共 **64 条**）：宋钦宗 → 赵桓、完颜兀术 → 完颜宗弼、金世宗 → 完颜雍、朱祁镇 → 明英宗、溥仪 → 宣统帝等。
- 为 10 条早期事件补「据《…》」出处括注，使全库事件均有出处。

### 数据

| 分期 / 断代 | 节点 | 边 | 默认中心 |
|---|---:|---:|---|
| 北宋 | 54 | 111 | 赵匡胤 |
| 南宋 | 61 | 116 | 岳飞 |
| 辽 | 46 | 77 | 耶律阿保机 |
| 西夏 | 29 | 46 | 李元昊 |
| 金 | 87 | 170 | 完颜阿骨打 |
| 元 | 75 | 120 | 忽必烈 |
| 明 | 76 | 126 | 朱元璋 |
| 清 | 75 | 137 | 康熙帝 |
| 简阅 宋辽金夏 | 205 | 386 | 赵匡胤 |
| 简阅 元明清 | 197 | 337 | 朱元璋 |

- 时间轴 **670 条**事件、23 个朝代 / 时期、7 个大断代；图谱细览 **18 期** + 简阅 **7 组**；25 张图谱合计 2366 个节点位、4323 条边、去重人物对 1909 对；关系库 **640 对**覆盖 1634 条图谱边。

### 文档

- `README.md`：版本号与数据快照、§5.1 分朝事件表、§5.2 图谱与关系覆盖表、路线图（V0.8.1 / V0.8.2 已完成）、已知限制、近期更新日志同步至 V0.8.2。
- `SPEC.md`：新增 §7.14「全朝代数据厚度对齐与校验（V0.8.2）」。
- `frontend/package.json`：版本号 0.8.0 → **0.8.2**。
- `frontend/data/timeline-events.ts` / `timeline-participants.ts` / `person-relations.ts` 文件头补 V0.8.2 说明。

### 验证

- **类型检查**：`tsc --noEmit` **0 error**。
- **全量数据校验**：`node scripts/validate-data.mjs` → **ALL CHECKS PASSED**（670 条事件无重复 id / 无 year=0 / 全部有出处；25 张图谱默认中心全部存在、0 孤儿节点、0 悬空边、节点边双向一致；640 对关系无重复 pairKey、eventSummaries 全部命中共同事件、全部在图谱中成边；64 条别名与 23 个名人堂标签组全部命中；docs 6 份 122 行全部覆盖）。
- 校验仅余 1 条历史警告（10 条关系定性超过 8 字，属既有数据保留，不阻塞）。

---

## [0.8.0] - 2026-11-20

> 版本主题：**元明清图谱里程碑（元明清由 V0.7.3 提升为独立里程碑 V0.8）+ `/graph` 顶部文案极简重构**（图谱 15 → 18 期、简阅 6 → 7 组；时间轴 496 条事件与 `PersonGraph2D` 力导向逻辑未改）。

### 变更

- **`/graph` 顶部文案极简重构**：删除约 230 字的「小作文」段落（原段落逐一罗列 15 个细览朝代、6 个简阅断代与全部交互说明），副标题压缩为一行——「点击节点看详情，长按切换中心，拖拽调整位置；支持别名搜索（如唐太宗）与简阅 / 细览切换。」；朝代清单交由 Tab 与开关自行呈现，正文不再重复。
- **复杂说明收进 `?` 悬浮气泡**：副标题末尾新增 `?` 图标，悬停或键盘聚焦时以 tooltip 展示「边粗细口径 / 三国阵营快捷入口 / 本名与庙号别名示例」，不占正文空间；`prefers-reduced-motion` 下取消淡入过渡。
- 首页入口文案同步为「春秋至清 · 18 期」，首页副标题补充元明清覆盖说明。

### 新增

- 解析 `docs/史脉_第四批_元明清.md`（68 行关系表，合并镜像行与跨批重复对后 50 个唯一人物对）：图谱细览新增 **元 / 明 / 清** 3 期（共 **18 期**），简阅新增 **元明清** 1 组（共 **7 组**）。
- 各期默认中心：**元 忽必烈 / 明 朱元璋 / 清 康熙帝**；简阅元明清 **朱元璋**。
- 清期补入两条明末前史事件（`ming-15` 宁远之战、`ming-18` 山海关之战），使「努尔哈赤 × 袁崇焕」「多尔衮 × 吴三桂」关系在清图中成边，与南宋补采石之战、辽补澶渊之盟同一口径。
- 搜索别名新增 **22 条**（元明清本名 / 庙号）：元太祖 / 铁木真 / 元世祖、明太祖 / 洪武 / 明成祖 / 永乐帝 / 明世宗 / 明武宗 / 明神宗 / 明思宗、清太祖 / 清太宗 / 清世祖 / 清圣祖 / 玄烨 / 清世宗 / 清高宗 / 弘历 / 清宣宗 / 清文宗 / 清德宗（共 **45 条**）。
- 名人堂新增 4 组配置：元 10、明 10、清 10、元明清 8。

### 数据

| 分期 | 节点 | 边 | 默认中心 | 关系覆盖 |
|---|---:|---:|---|---|
| 元 | 13 | 15 | 忽必烈（4 位直接关系人） | 9/15 |
| 明 | 27 | 26 | 朱元璋（5 位直接关系人） | 22/26 |
| 清 | 24 | 27 | 康熙帝（4 位直接关系人） | 22/27 |
| 简阅 元明清 | 58 | 64 | 朱元璋（5 位直接关系人） | 50/64 |

- 关系库 **411 → 461 对**（新增 50 对：元 9 / 明 21 / 清 20，其中「袁崇焕 × 努尔哈赤」跨明、清两期共用）；未覆盖边回退事件正文摘要。
- 时间轴仍为 **496 条事件**：元明清既有 52 条事件（元 10 / 明 20 / 清 22）已覆盖关系表全部 68 行，**本版无需新增事件**。

### 文档

- `README.md`：版本号、数据快照（18 期 / 7 组）、图谱统计表（新增 4 行）、路线图（元明清提升为独立里程碑 V0.8.0）、已知限制与「更新日志（近期）」同步。
- `SPEC.md`：新增 §7.12「元明清图谱分期（V0.8.0）」与 §7.13「图页文案与帮助气泡规范（V0.8.0）」。
- `CHANGELOG.md`：新增本版记录；`[Unreleased]` 规划改为 V0.8.1 收尾。
- `frontend/data/person-relations.ts` / `person-graph.ts` 文件头补 V0.8.0 覆盖范围说明。

### 验证

- **类型检查**：`tsc --noEmit` 0 error。
- **数据自检**（tsc 转译后以 Node 直跑）：18 期 / 7 组配置齐全，`ERA_TO_SCOPE` / `SCOPE_TO_ERA` 双向映射完整；默认中心全部存在；名人堂 23 个标签组全部命中当期节点；45 条别名全部指向有效节点；461 对关系无重复 `pairKey`，50 对新关系的 `eventSummaries` 键全部命中两人共同事件；关系覆盖与本文档一致（元 9/15、明 22/26、清 22/27、简阅元明清 50/64）→ **ALL CHECKS PASSED**。
- **生产构建**：在 `.tmp` 隔离副本中运行 `next build`（webpack 模式，含全量 TypeScript 检查）→ `✓ Compiled successfully`，`/`、`/graph`、`/timeline` 全部静态预渲染通过；未直接在本目录构建，避免覆盖运行中 dev 服务的 `.next` 产物。
- **文档源校验**：脚本解析 `docs/史脉_第四批_元明清.md` 的 68 行关系表 → 合并镜像行后 50 个唯一人物对，关系库命中 **50 / 50**（ALL DOC ROWS COVERED）。
- **无头 Edge 157 + CDP 实测 `/graph`**：顶部副标题高度 25px（单行）、不含朝代清单，`?` 气泡默认 `visibility: hidden`、聚焦后可见且不溢出视口（1440px 宽 360px；390px 窄屏改为整宽铺开、副标题自然换行 2 行）；清期 24 人 / 27 边、默认中心康熙帝，搜索框输入「康熙」下拉即时命中「康熙帝」，点击后中心切换、SVG 描述为「以康熙帝为中心…共 4 位直接关系人」；元 13/15 中心忽必烈、明 27/26 中心朱元璋；简阅 7 组、切「元明清」为 58 人 / 64 边；控制台 0 异常。

---

## [0.7.2] - 2026-11-20

> 版本主题：**隋唐与五代辽宋夏金图谱分期 + 人物关系注入**（图谱 7 → 15 期、简阅 4 → 6 组；时间轴数据与 `PersonGraph2D` 力导向逻辑未改）。

### 新增

- 解析 `docs/史脉_第二批_隋唐.md`（66 行）与 `docs/史脉_第三批_五代辽宋夏金.md`（64 行）：90 个唯一事件名映射到 79 个既有时间轴事件 id，新增 **99 对**关系记录（103 条「人物对—事件」简述直接取自表内，其中 4 对为多事件关系）。
- 图谱细览新增 **8 个分期**：**隋 / 唐 / 五代十国 / 北宋 / 南宋 / 辽 / 西夏 / 金**（图谱共 15 期）；简阅新增 **2 个分组**：**隋唐 / 宋辽金夏**（共 6 组）。
- 各期默认中心：隋 杨坚、唐 李世民、五代十国 赵匡胤、北宋 赵匡胤、南宋 岳飞、辽 耶律阿保机、西夏 李元昊、金 完颜阿骨打；简阅隋唐 李世民、宋辽金夏 赵匡胤。
- 稀疏期补入跨期前史事件：南宋期含「采石之战」（金），辽期含「割燕云十六州」（五代）与「澶渊之盟」（北宋），西夏期含「庆历新政」「西北御夏」（北宋），金期含「海上之盟」（北宋）。
- 搜索别名新增 **11 条**：隋文帝 / 隋炀帝、唐高祖 / 唐太宗 / 唐高宗 / 唐玄宗、武后 / 则天皇后、宋太祖 / 宋太宗 / 宋真宗 / 宋神宗 / 宋徽宗 / 宋高宗、辽太祖、金太祖（共 23 条）。
- 名人堂新增 10 组配置：隋 8、唐 10、五代十国 8、北宋 8、南宋 8、辽 8、西夏 6、金 6、隋唐 8、宋辽金夏 8。

### 变更

- `GraphDynasty` 扩展至隋、唐、五代十国、北宋、南宋、辽、西夏、金；`PersonGraphEraId` 增加 8 个值，`PersonGraphScopeId` 增加 `suitang` / `songliaojinxia`。
- 图表映射：隋 / 唐 → 简阅「隋唐」；五代十国 / 北宋 / 南宋 / 辽 / 西夏 / 金 → 简阅「宋辽金夏」（五代十国作为前史并入，与三国期含汉末、南北朝期含东晋末同一口径）。
- `/graph` 页面版本标识更新为 V0.7.2，页面文案改为 15 期 / 6 组并说明别名搜索；首页入口文案更新为「春秋至宋辽金夏 · 15 期」。
- `SPEC.md` §7.11 新增隋唐—宋辽金夏图谱分期约定。

### 数据

| 分期 | 节点 | 边 | 默认中心 | 关系覆盖 |
|---|---:|---:|---|---|
| 隋 | 16 | 28 | 杨坚（8 位直接关系人） | 13/28 |
| 唐 | 65 | 90 | 李世民（12 位） | 39/90 |
| 五代十国 | 25 | 24 | 赵匡胤（5 位） | 12/24 |
| 北宋 | 22 | 32 | 赵匡胤（5 位） | 20/32 |
| 南宋 | 16 | 23 | 岳飞（5 位） | 12/23 |
| 辽 | 10 | 15 | 耶律阿保机（3 位） | 6/15 |
| 西夏 | 6 | 8 | 李元昊（2 位） | 7/8 |
| 金 | 7 | 6 | 完颜阿骨打（3 位） | 4/6 |
| 简阅 隋唐 | 79 | 117 | 李世民（13 位） | 51/117 |
| 简阅 宋辽金夏 | 67 | 88 | 赵匡胤（9 位） | 49/88 |

- 关系库 **312 → 411 对**；未覆盖边回退事件正文摘要（与秦汉、春秋战国口径一致）。

### 文档

- `README.md`：版本号、数据快照（15 期 / 6 组）、图谱统计表（新增 10 行）、路线图、已知限制与「更新日志（近期）」同步。
- `CHANGELOG.md`：新增本版记录。
- `frontend/data/person-relations.ts` 文件头补 V0.7.2 覆盖范围说明。

### 验证

- `tsc --noEmit` 0 error；`next build` 通过。
- 数据脚本：15 期 / 6 组、默认中心全部存在、名人堂 19 组全部命中、23 条别名指向有效节点、411 对关系全部有对应图谱边、99 对新关系简述全部命中共同事件 → 0 问题。
- 无头 Edge + CDP：`/graph` 15 期 ↔ 6 组；隋期 16 人 / 28 边、中心杨坚；唐期 65 人 / 90 边、中心李世民，单击魏徵显示「君臣（纳谏）/ 贞观之治 + 简述」；北宋 22 人 / 32 边、中心赵匡胤，单击赵普显示「杯酒释兵权」关系；五代十国 25 人 / 24 边、中心赵匡胤；简阅 6 组、切期中心保留 / 回落正常；搜索「唐太宗」命中李世民；控制台 0 异常。

---

## [0.7.1] - 2026-11-20

> 版本主题：**Tab 栏「丝滑拖动」交互升级 + 隋唐五代事件精修**（数据层与 UI 层各一项；V0.7.0 为全量朝代数据灌入版）。

### 新增

- **指针拖拽滚动**（`ScrollableTabs`）：鼠标 / 触控按住 Tab 栏即可左右拖动，使用 Pointer Events（`pointerdown` / `pointermove` / `pointerup` / `pointercancel`）；拖动超过 5px 后捕获指针并进入拖拽态。
- **惯性滑行（Momentum）**：松手时按最后速度继续滚动，逐帧按摩擦系数衰减，撞到首尾端点即停；`prefers-reduced-motion` 时关闭惯性。
- **光标反馈**：悬停 `cursor: grab`，拖动中 `cursor: grabbing`；拖拽中禁用子 Tab 的 hover/pointer 事件，避免抖动。
- **点击防误触**：位移 >5px 判定为拖拽，松手后吞掉该次 click，拖动 Tab 栏不会误切朝代；原地点击仍然正常切换。
- **数据**：补充隋唐至五代十国初期 **34 条**核心历史事件（隋 7 / 唐 18 / 五代十国 9），脱离 docs 关系表、按正史脉络撰写，全部带出处括注；其中 **10 条**标记 `importance: 3`（科举制创立、开凿大运河、三征高句丽、文成公主入藏、唐灭高句丽、两税法推行、黄巢起义、高平之战、后周世宗改革、北汉灭亡）。
- 新增参与者节点：宇文恺、周静帝、王薄、玄奘、松赞干布、文成公主、李勣、薛仁贵、王孝杰、张说、高仙芝、鉴真、杨炎、王叔文、李诵、李纯、裴度、李愬、吴元济、李恒、赤祖德赞、李昂、仇士良、李炎、李忱、黄巢、王仙芝、李儇、王建、孟知祥、李昪、刘知远、刘崇、刘继元、钱俶、李璟等。

### 变更

- **Tab 箭头位置**：由绝对定位覆盖在胶囊内部改为滚动容器的 **flex 兄弟节点**（外侧占位），彻底解决左箭头遮挡第一个 Tab 文字的问题；箭头仅在对应方向可滚动时渲染，不占用无意义空间。
- 时间轴事件总数 **462 → 496 条**；简阅断代级事件 **101 → 111 条**；隋 9 → 16 条、唐 27 → 45 条、五代十国 12 → 21 条。
- `/graph` 页面版本标识同步为 V0.7.1（图谱数据仍为 7 期，分期扩充在 V0.7.2）。
- `SPEC.md` §5.9 补充 Tab 拖拽 / 惯性 / 箭头外置的交互约定。

### 文档

- `README.md`：版本号、数据快照（496 条 / 23 朝）、时间轴统计表（补齐隋—清各朝）、路线图（V0.7.0 / V0.7.1 已完成）同步；正文末尾新增「十二、更新日志（近期）」。
- `CHANGELOG.md`：新增本版与 V0.7.0 记录。
- `frontend/data/timeline-events.ts` 文件头补「第 7 批（V0.7.1 隋唐五代精修）」来源与批次说明。

### 验证

- `tsc --noEmit` 0 error；`next build` 通过。
- 数据脚本：496 条事件、23 个朝代、7 个简阅分组、无重复 id、无 year=0、111 条断代级事件、新批次同年同名事件已合并 → 0 问题。
- 无头 Edge + CDP：
  - Tab 箭头与滚动容器无重叠（箭头矩形在容器外侧），首尾 Tab 文字完整可见；
  - 1440px 视口 23 个 Tab 溢出，鼠标按住拖拽可滚动、松手惯性继续滑行、`cursor` 分别为 `grab / grabbing`；
  - 拖动 60px 后松手，选中朝代保持不变（click 被吞）；原地点击可正常切换；
  - 隋唐 Tab 事件数 16 / 45 / 21（隋 / 唐 / 五代十国），简阅 7 断代正常；控制台 0 异常。

---

## [0.7.0] - 2026-11-20

> 版本主题：**全量朝代数据灌入**（V0.7–V0.10 合并执行的第一步：只灌时间轴数据，图谱分期留待 V0.7.2）。

### 新增

- 解析 `docs/史脉_第二批_隋唐.md`、`史脉_第三批_五代辽宋夏金.md`、`史脉_第四批_元明清.md` 三份人物关系表：198 行关系 → 149 个唯一「共同参与事件」→ 归并 **131 场史事**（同一史事的不同表述合并，同年同史事只留一条）。
- `Dynasty` 联合类型新增 **11 个朝代/时期**：隋、唐、五代十国、辽、北宋、西夏、金、南宋、元、明、清；`DYNASTY_START_YEARS` 同步补起始年。
- `DYNASTY_GROUPS` 新增 **3 个简阅断代**：隋唐 / 五代辽宋夏金 / 元明清（简阅 4 → 7 组）；时间轴 Tab 12 → **23 个**。
- 新增 **131 条**时间轴事件（隋 9 / 唐 27 / 五代十国 12 / 辽 3 / 北宋 15 / 西夏 2 / 金 3 / 南宋 8 / 元 10 / 明 20 / 清 22），其中 **46 条**断代级事件（`importance: 3`），全部带出处括注与参与者。
- 时间轴页脚补《隋书》《旧唐书》《新唐书》《旧五代史》《新五代史》《辽史》《宋史》《金史》《元史》《明史》《清史稿》等正史来源；首页文案更新为「夏—清」。

### 数据

- 时间轴事件总数 **331 → 462 条**；断代级事件 **55 → 101 条**。
- 朝代/时期 **12 → 23 个**；简阅分组 **4 → 7 个**。
- 断代口径例外：元含大蒙古国前史（1219 西征、1234 灭金），清含后金前史（1616 / 1636），896「讨灭董昌」归唐。

### 验证

- `tsc --noEmit` 0 error；`next build` 通过。
- 数据脚本：462 条事件、id 唯一、无 year=0、23 个朝代均有事件、同年同名事件无重复、131 条新事件全部带出处 → 0 问题。
- 无头 Edge + CDP：23 个朝代 Tab 溢出并可横向滚动、右侧箭头出现、切换到「清」自动滚动到末尾、北宋 15 条事件上轴、简阅 7 断代（细览清 → 元明清）、`/graph` 回归正常、控制台 0 异常。

---

## [0.6.4] - 2026-11-20

> 版本主题：**魏晋南北朝图谱分期 + Tab 横向滑动补丁**（时间轴数据与 `PersonGraph2D` 力导向逻辑未改；新增 `ScrollableTabs` 共用组件）。

### 新增

- 人物关系图细览新增 **3 个分期**：**西晋 / 东晋十六国 / 南北朝**（图谱共 7 期）；简阅新增 **1 个断代**：**魏晋南北朝**（共 4 组）。
- 新增 `frontend/data/weijin-events.ts`：解析 `docs/史脉_第一批_魏晋南北朝.md` 得到 **34 个图谱补足事件**（`weijin-*`，只进人物图、不进时间轴）；表中与时间轴同题的事件（淝水之战、八王之乱、兰亭雅集、高平陵之变等 18 条）直接复用既有事件 id。
- 图谱事件白名单 `XIJIN_EVENT_IDS` / `DONGJIN_EVENT_IDS` / `NANBEICHAO_EVENT_IDS`：西晋期含曹魏末年作为前史；南北朝期复用东晋末「讨灭桓玄」；与三国期复用汉末事件同一口径。
- 关系库 **+86 对**（226 → **312 对**）：表中解析 49 对 + 补全 37 对（含司马师×曹爽、淝水诸将、刘裕/杨坚核心关系等）；新增 90 条「人物对—事件」简述、52 条关系说明。
- 新增名人堂 4 组：西晋（司马炎、司马懿、司马昭、羊祜、杜预、贾南风、石崇、陆机）、东晋十六国（王导、谢安、谢玄、苻坚、王猛、桓温、王羲之、刘裕）、南北朝（刘裕、拓跋焘、孝文帝、冯太后、高欢、宇文泰、宇文邕、杨坚）、魏晋南北朝（简阅）。
- 搜索别名 `PERSON_NAME_ALIASES`（7 条）：如「拓跋宏 / 元宏 / 魏孝文帝 → 孝文帝」「梁武帝 → 萧衍」「宋武帝 → 刘裕」。
- 新增共用组件 `frontend/components/ScrollableTabs.tsx`（+ CSS）：Tab 栏横向滚动、隐藏滚动条、两端渐隐箭头、选中项自动居中；时间轴与人物图同时接入。

### 变更

- **期切换保留中心**：`/graph` 切换分期时不再强制重置为默认中心，当前中心在目标图中存在则保留，否则回落默认（与模式切换同一规则）。
- 三国期因「司马师」补入高平陵之变，图谱由 62 人 / 173 边变为 **63 人 / 176 边**，关系覆盖仍为 **176/176（100%）**。
- 既有时间为轴的 12 位参与者补齐：司马师、司马昭、羊祜、司马伦、司马颖、陆机、拓跋嗣、拓跋恂、拓跋澄、李冲、刘裕、宇文宪（只加人不改 id / year / 文案）。
- 时间轴与图谱的 Tab 样式收拢到 `ScrollableTabs.module.css`（内边距统一为 8×20），两页视觉与滑动行为一致。
- `/graph` 版本标识更新为 V0.6.4，首页与图谱页文案同步魏晋分期；`SPEC.md` 补 §5.9「Tab 横向滑动」、§7.10「魏晋南北朝图谱分期」，§7.9 更新为 7 期。

### 数据

- 新增三期规模：西晋 **35 人 / 60 边**（中心司马炎，11 位直接关系人）、东晋十六国 **29 人 / 33 边**（中心谢安，6 位）、南北朝 **36 人 / 42 边**（中心孝文帝，4 位）；简阅魏晋南北朝 **93 人 / 131 边**（中心刘裕，7 位）。
- 关系覆盖：西晋 37/60、东晋十六国 27/33、南北朝 31/42、简阅魏晋 92/131；未覆盖边回退事件正文摘要（与秦汉、春秋战国口径一致）。
- 时间轴事件总数保持 **331 条**（补足事件仅用于图谱）；`person-relations.ts` 共 **312 对**关系。

### 文档

- `README.md`（版本、图谱统计、Tab 滑动、已知限制）、`CHANGELOG.md`、`docs/V0.6-V0.6.1-数据清单.md`（新增 §15 V0.6.4 记录）同步。

### 验证

- `tsc --noEmit` 0 error；`next build` 通过（`/`、`/timeline`、`/graph` 全部静态生成）。
- 数据脚本：7 期 / 4 组数据集、关系记录 312 对全部有对应图谱边、0 条简述指向非共同事件、三国 176/176 覆盖、默认中心 / 名人堂 / 别名全部存在、34 个补足事件全部入图 → **0 问题**。
- 无头 Edge + CDP：`/graph` 7 期 ↔ 4 组；东晋期单击苻坚 → 右栏「谢安 × 苻坚 / 对手（决战）/ 淝水之战 + 简述」；谢安不在南北朝时回落孝文帝；西晋期司马炎 × 司马昭面板正常；简阅魏晋 93 人 / 131 边、刘裕 × 桓玄可点通；切期/切模式中心保留；`/graph` 与 `/timeline` Tab 窄屏横向滑动、隐藏滚动条、两端箭头显隐、选中 Tab 自动居中；控制台 0 异常。

---

## [0.6.3] - 2026-11-20

> 版本主题：**简阅 / 细览双视图 + 先秦图谱与关系补全**（数据层与局部 UI 加法；时间轴错层算法与 `PersonGraph2D` 力导向逻辑未改）。

### 新增

- **「简阅 / 细览」视图开关**（`frontend/components/ViewModeSwitch.tsx`），时间轴与人物图共用同一套视觉与回调约定：
  - 时间轴简阅 = 4 个断代 Tab（**先秦 / 秦汉 / 三国 / 魏晋南北朝**），只渲染 `importance === 3` 的断代大势事件；
  - 图谱简阅 = 3 个断代分期（**先秦 / 秦汉 / 三国**）。
- 数据：`TimelineEvent` 新增 `importance?: 1 | 2 | 3`（缺省视为 2）与 `importanceOf()`；**55 条**顶级事件打标（先秦 18 / 秦汉 15 / 三国 9 / 魏晋南北朝 13）。
- 数据：**夏、商、西周 33 条事件补参与者**，新增 33 位先秦节点（尧、舜、鲧、禹、商汤、伊尹、太甲、盘庚、武丁、傅说、商纣王、妲己、周文王、姜子牙、比干、微子、周武王、箕子、周公旦、周成王、周康王、管叔、蔡叔、共伯和、周厉王、周宣王、周幽王、褒姒等）。
- 图谱：新增 **「先秦」简阅分期**（219 人 / 316 边，默认中心 周公旦）；`GraphDynasty` 补入夏、商、西周；名人堂新增「先秦」8 位（周公旦、商汤、周文王、周武王、姜子牙、孔子、齐桓公、孙武）。
- 关系库 **+53 对**：先秦（夏商西周）29 对 + 楚汉 24 对（范增、项梁、章邯、陈平 与刘邦/项羽等补齐）；关系库 173 → **226 对**。

### 变更

- 时间轴：新增 `DYNASTY_GROUPS` 大断代配置与 `groupOfDynasty()`；Tab 行右侧放置开关；细览 Tab 仍由数据自动推导（12 个）。Tab 内边距由 `8×26` 收窄为 `8×20`，为开关腾出同行空间。
- **状态保持**：时间轴记住「每个断代的细分朝代」，简 ↔ 细切换回到原处；选中事件在两种模式下都存在时保留选中卡。
- 图谱：新增 `PERSON_GRAPH_SCOPES` 与 `ERA_TO_SCOPE` / `SCOPE_TO_ERA` 映射；切换模式时当前中心人物若在目标图中存在则保留（如 春秋·孔子 → 简阅·先秦 仍以孔子为中心），否则落到目标期默认中心。
- 图谱 meta 由「默认中心」改为动态「当前中心」；三国阵营快捷按钮判定改为「当前视图 id === sanguo」，简阅 / 细览两种模式都显示。
- `SPEC.md` 补 §5.8「简阅 / 细览双视图」与 §7.9「简阅 / 细览图谱分期」。

### 文档

- `README.md`、`CHANGELOG.md`、`docs/V0.6-V0.6.1-数据清单.md` 同步 V0.6.3 数据、统计与路线图（V0.6.4 承接魏晋分期与 UI 滑动补丁）。

### 验证

- `npx tsc --noEmit` 通过（0 error）。
- 数据校验脚本（已删除）：先秦图 219 人 / 316 边；夏商周 29 / 29 边有 relation、41 / 41 条简述；楚汉 24 / 24 边、25 / 25 条简述；importance 四组 18 / 15 / 9 / 13（均 ≥ 6）。
- 无头 Edge + CDP 端到端：
  - `/timeline`：细览 12 Tab ↔ 简阅 4 Tab；先秦 18 点、秦汉 15 点；细→简保留选中「大禹治水」；简→细回到原细分朝代（秦汉→秦、先秦→春秋）。
  - `/graph`：细览 4 期 ↔ 简阅 3 组；简阅先秦「219 人 · 316 边」；搜索「周公旦」→ 6 位直接关系人（周武王、周成王、周康王、姜子牙、管叔、蔡叔），面板「周公旦 × 周成王」4 件事件全带关系与简述；三国阵营按钮在简/细两种模式都显示、切秦汉隐藏。

---

## [0.6.2] - 2026-11-19

> 版本主题：**三国图谱的人物节点与前置事件扩充**（用汉末群雄事件带动孙吴、曹魏、蜀汉与群雄人物入图；时间轴渲染与 `PersonGraph2D` 力导向逻辑零改动）。

### 新增

- 新增 **19 条东汉末年事件**（191—219，第 5 批）：孙坚战死、刘备附公孙瓒、孙策渡江、袁术攻徐州、袁术称帝、宛城之战、下邳之战、易京之战、孙策遇刺、司马徽荐卧龙凤雏、曹操赎蔡琰、刘表病卒、华佗被杀、刘备入蜀、潼关之战、马超归降、雒城之战、定军山之战、刘备称汉中王。事件 ID 为 `hanmo-01`—`hanmo-19`，归入东汉 Tab。
- **3 条既有事件补参与者**（只加人不改 id / year / 文案）：
  - 官渡之战 → 补 荀彧、郭嘉、张辽、徐晃、关羽（白马斩颜良、封金挂印均在官渡期间）；
  - 赤壁之战 → 补 甘宁（随周瑜破曹于乌林）；
  - 襄樊之战 → 补 徐晃（率新兵救曹仁、破关羽于四冢）。
- 三国图谱新增 **23 位人物**并全部入图：孙坚、孙策、太史慈、甘宁；张辽、徐晃、许褚、典韦、荀彧、郭嘉、夏侯惇；庞统、法正、魏延、黄忠、马超；袁术、公孙瓒、刘表、刘璋；司马徽、华佗、蔡文姬。另有长尾节点 张绣、夏侯渊。
- `SAN_GUO_EVENT_IDS` 白名单新增 `hanmo-01`—`hanmo-19`。
- 名人堂 · 三国由 8 位扩至 **10 位**：新增 孙策、孙坚。
- 关系库 **87 → 173 对**：新增 86 对关系记录与 98 条「人物对—事件」简述；三国期 202 条简述全覆盖、0 回退。

### 数据

- 事件总数 312 → **331 条**；东汉 Tab 38 → **57 条**。
- 三国图谱 **37 人 / 87 边 → 62 人 / 173 边**。
- 秦汉图谱随新事件自然增益：198 人 / 409 边 → **224 人 / 497 边**。
- 孙策入图后连向 7 人：孙坚、孙权、周瑜、太史慈、袁术、曹操、刘表。

### 文档

- `CHANGELOG.md`、`README.md`、`docs/V0.6-V0.6.1-数据清单.md` 同步 V0.6.2 数据与统计；版本路线图新增 V0.6.3（关系补丁）、V0.6.4（UI 滑动补丁）。
- 无 SPEC 改动：本次只扩充数据，未新增交互行为。

### 验证

- `npx tsc --noEmit` 通过（0 error）。
- 数据校验脚本（已删除）：62 人 / 173 边 / 173 条关系记录，202 条事件简述全覆盖、无缺失无冗余、新人物全部入图 → 0 问题。
- 无头 Edge + CDP 端到端：三国期「62 位人物 · 173 条关系」；左栏搜索「孙策」→ 中心切为孙策，一度关系 7 人（曹操、刘表、孙坚、孙权、太史慈、袁术、周瑜）；键盘选中「孙权」→ 右栏显示「孙策 × 孙权 / 兄弟 / 孙策遇刺，孙权继位 + 简述」。

---

## [0.6.1] - 2026-11-19

> 版本主题：**三国人物关系网 + 关系详情增强**（`PersonGraph2D` 的力导向渲染与交互逻辑零改动，只升级右侧面板与数据层）。

### 新增

- 人物关系图新增「三国」分期：**37 位人物 / 87 条关系 / 默认中心曹操**。事件来源为三国 11 条 + 汉末关键节点 7 条（189 董卓之乱、190 关东联军、192 董卓被诛、196 迎帝都许、200 官渡、208 赤壁、219 襄樊）；其余东汉事件不纳入，避免把张衡、班超等无关人物带入三国图。
- **阵营快捷按钮**：左栏顶部 `魏 · 曹操`、`蜀 · 刘备`、`吴 · 孙权` 三个醒目按钮，点击直接复用现有换中心逻辑；仅在三国分期渲染，切到春秋 / 战国 / 秦汉自动隐藏。
- **名人堂 · 三国** 8 位：曹操、刘备、孙权、诸葛亮、关羽、司马懿、周瑜、陆逊。
- **两人关系数据** `frontend/data/person-relations.ts`（新文件）：与事件库解耦的「人物对」数据，含 `label`（关系定性）、可选 `description`（来龙去脉）、`eventSummaries`（按事件 id 的两人视角简述）。三国期 **87 对关系全部收录、100 个「人物对—事件」简述全部定制**（19 对带关系说明，无回退）。
- 关系面板升级：选中相邻人物后显示关系徽章与关系说明；每条共同事件下方新增事件简述，事件行同时标注朝代。
- `GraphEventReference` 新增 `summary`（事件正文摘要，缺省回退用）；`PersonGraphEdge` 新增可选 `relation`。

### 变更

- `/graph` 分期 Tab 增至 4 个（春秋 / 战国 / 秦汉 / 三国），默认仍为春秋；页面版本标识更新为 V0.6.1。
- 操作提示改为「单击人物查看两人关系与共同事件」。
- 关系数据按「人物对」跨分期共用：秦汉分期里同名的曹操 × 刘备、汉灵帝 × 何进等人物对也会显示关系徽章（既有数据的即时增益）；秦汉、春秋战国的其余人物对留待 V0.6.3 补丁。
- 秦汉分期受 V0.6 数据变动影响（新增 219 襄樊、220 事件迁入三国），规模由 194 节点 / 396 边变为 **198 节点 / 409 边**。

### 文档

- `SPEC.md` §7.1 补「分期专属快捷入口」，§7.2 补阵营按钮点击语义（第 5 个换中心入口）。
- `README.md` 同步版本、图谱分期、关系数据模型与数据统计。
- `docs/V0.6-V0.6.1-数据清单.md` 更新为已完成状态，并补记关系数据结构与校验结果。

### 验证

- `npx tsc --noEmit` 通过（0 error）。
- 数据校验脚本（已删除）：87 / 87 条边有 `relation`、100 / 100 条事件简述齐全、无多余或缺失记录、默认中心与名人堂 / 阵营人物均在图中。
- 无头 Edge + CDP 端到端：`/graph` 4 个分期 Tab；三国期「37 位人物 · 87 条关系 · 默认中心 曹操」；阵营按钮 3 个、切秦汉后为 0；点击「魏 · 曹操」中心切换；键盘选中「刘备」后右栏显示「曹操 × 刘备 / 对手 / 赤壁之战 + 事件简述」，控制台无报错。

---

## [0.6.0] - 2026-11-19

> 版本主题：**三国两晋南北朝时间轴与数据基建**（V0.6；时间轴渲染逻辑与 `PersonGraph2D` 零改动）。

### 新增

- 新增 **4 个朝代分期**：三国（220—280）、西晋（265—316）、东晋十六国（317—420）、南北朝（420—589）。时间轴 Tab 由数据自动推导，新增分期后自动出现，无需改动渲染代码。
- 新增 **40 条事件**：
  - 三国 10 条：刘备称帝 221、夷陵之战 222、白帝城托孤 223、诸葛亮南征 225、街亭之战 228、孙权称帝 229、诸葛亮病逝五丈原 234、高平陵之变 249、嵇康被杀 262、魏灭蜀 263；
  - 西晋 7 条：司马炎代魏 265、晋灭吴 280、贾后干政 290、八王之乱 291、刘渊起兵 304、永嘉之乱 311、西晋灭亡 316；
  - 东晋十六国 10 条：司马睿建东晋 317、王敦之乱 322、石勒灭前赵 329、兰亭雅集 353、桓温收复洛阳 356、前秦灭前燕 370、淝水之战 383、北魏建立 386、桓玄篡晋 403、刘裕灭后秦 417；
  - 南北朝 12 条：刘宋建立 420、北魏统一北方 439、孝文帝太和改制 485、迁都洛阳与汉化 494、六镇起义 523、河阴之变 528、北魏分裂 534、侯景之乱 548、北齐代东魏 550、北周灭北齐 577、杨坚代周 581、隋灭陈 589；
  - 东汉末年边界 1 条：襄樊之战 219（关羽败走麦城），为关羽、吕蒙等人物提供关系事件来源。
- 补齐上述 41 条事件的 `EVENT_PARTICIPANTS`（`frontend/data/timeline-participants.ts`）。
- `timeline-events.ts` 文件头补「第 4 批」数据来源与批次说明；时间轴页脚补正史来源署名。

### 变更

- `handong-han-fall`（曹丕篡汉，220）由「东汉」改隶「三国」：`id` / `year` / 标题 / 描述 / 参与者均不变，仅 `dynasty` 改动（220 年边界的方案 A）。
- `Dynasty` 联合类型新增 4 个值；`DYNASTY_START_YEARS` 新增 220 / 265 / 317 / 420。
- 时间轴选择器 8 → 12 个 Tab；「东晋十六国」增加口径说明「（十六国附见）」。
- 首页副标题改为「时间轴覆盖夏—南北朝（含新莽、三国两晋十六国）」；时间轴入口文案改为「夏—南北朝 · 逐朝浏览大事记」。

### 数据

- 事件总数 272 → **312 条**；朝代/时期 8 → **12 个**。
- 新增事件据《三国志》《晋书》《宋书》《魏书》《梁书》《北齐书》《周书》《隋书》等公有领域正史撰写，逐条保留出处括注。
- 参与者索引 222 → **262 条**（除夏、商、西周 50 条外全部覆盖）。

### 文档

- `docs/V0.6-V0.6.1-数据清单.md`：补记 6 项决策结论、修正总数口径（312 条）、标记第一阶段完成。
- `README.md`：版本号、数据规模统计、路线图与数据来源同步至 V0.6。

### 验证

- `npx tsc --noEmit` 通过（0 error）。
- 数据自检：312 条事件、id 无重复、无 `year = 0`、无非法 dynasty、本批 41 条参与者条目齐全、年份范围 −2100—589。

---

## [0.5.2] - 2026-11-19

> 版本主题：**图谱三栏导航**（外层 UI 优化，底层力导向图组件零改动）。

### 新增

- `/graph` 页面重构为经典三栏布局：**左栏 240px（人物搜索 + 名人堂）｜ 中栏（画布，自适应剩余宽度）｜ 右栏 280px（`PersonGraph2D` 自带关系面板）**。
- 左栏「搜索人物」：按当前分期提取全部人物（春秋 77 / 战国 112 / 秦汉 194），前缀优先的模糊匹配，下拉最多 8 条候选；支持点击、回车、方向键选择与 Esc 收起，选中后直接切换中心人物。
- 左栏「名人堂」：新增全局配置常量 `KEY_FIGURES`（`frontend/data/person-graph.ts`），按分期渲染代表性人物；当前中心人物高亮，配置中不存在于当期数据的人名会被自动过滤。
- 搜索、名人堂、图上长按三条入口统一走同一套「切换中心」逻辑；切换分期时重置搜索状态与默认中心。
- 响应式：≤1180px 时左栏移至画布上方并改为「搜索｜名人堂」并排；≤720px 单列堆叠。
- 新增本 `CHANGELOG.md`；重写 `README.md` 为完整的项目文档（简介、技术栈、目录结构、运行与构建、数据规模、数据模型、路线图、数据来源与许可、已知限制）。

### 变更

- `/graph` 页面容器最大宽度由 1240px 调整为 1400px，为三栏布局留出画布宽度。
- 页面文案与版本标识更新为 V0.5.2；操作提示明确「左栏搜索 / 名人堂可直达深处节点」。
- `PersonGraph2D`（组件逻辑、样式、交互）与 `/timeline` 页面均未改动。

### 验证

- `tsc --noEmit` 与 `pnpm build` 通过（`/`、`/timeline`、`/graph` 全部静态生成成功）。
- 使用无头 Edge + CDP 做真实浏览器端到端验证：切换「秦汉」→ 名人堂正确变为秦始皇 / 刘邦 / 项羽 / 汉武帝 / 张良；搜索「秦始皇」→ 下拉命中并切换中心，画布与右栏同步为「秦始皇 · 9 位直接关系人」；点击名人堂「刘邦」→ 切换为 26 位直接关系人；页面水合正常、控制台 0 错误。
- 布局实测（1440px 视口）：左栏 240px / 画布 813px / 右栏 280px，三栏顶部对齐；900px 视口下左栏自动移至画布上方。

---

## [0.5.1] - 2026-11-19

> 版本主题：**春秋战国人物关系网**（与 V0.5 合并开发、先后验收）。

### 新增

- 人物关系图新增分期能力：`PERSON_GRAPH_ERAS` 提供 **春秋（默认中心孔子）/ 战国（商鞅）/ 秦汉（刘邦）** 三个独立数据集，各自拥有默认中心人物。
- `/graph` 增加分期选择 Tab；切换分期时重置为该期默认中心，避免把上一期人物当中心导致空图。
- 春秋战国 **100 条事件**的 `participants` 全部补齐（`frontend/data/timeline-participants.ts`），人名统一为史书通称（如「吴王阖闾」「越王勾践」「秦始皇」为同一节点）。
- 兼容导出保留：`QIN_HAN_PERSON_GRAPH`、`DEFAULT_GRAPH_CENTER_PERSON` 继续可用。

### 数据

- 关系网规模：春秋 **77 节点 / 110 边**、战国 **112 节点 / 180 边**、秦汉 **194 节点 / 396 边**（节点与边均由事件参与者自动派生）。
- 三个分期为独立数据集，跨期人物在各期分别计数。

### 验证

- 数据自检通过：id 唯一、无公元 0 年、边端点存在、无自环、`weight` 与共同事件数一致、默认中心人物存在、无跨朝代事件混入。
- `tsc --noEmit` 与 `pnpm build` 通过；SSR 抓取确认 `/graph` 默认春秋、中心「孔子」、三个分期 Tab 正常。

---

## [0.5.0] - 2026-11-19

> 版本主题：**春秋战国时间轴补遗**（在已有 86 条基础上补齐关键节点）。

### 新增

- 新增 **14 条**春秋战国核心事件（春秋 7 条 / 战国 7 条）：
  - 春秋：齐桓公救燕北伐山戎、孔子诞生、弭兵之会、子产铸刑书、晏子使楚、孔子问礼于老子、孔子归鲁删述六经；
  - 战国：墨子止楚攻宋、魏文侯礼贤·李悝变法、田氏代齐、邹忌讽齐王纳谏、五国相王、燕昭王筑黄金台招贤、将相和（负荆请罪）。
- 补齐诸子百家诞生、变法、霸政外交、名将等主题缺口；事件 id 只增不改，按年份插入对应朝代块。

### 数据

- 事件总量 258 → **272 条**；春秋 38 → **45 条**，战国 48 → **55 条**（春秋战国合计 100 条）。
- 新增条目除《史记》外，另据《左传》《墨子》《晏子春秋》《汉书·食货志》等公有领域原文补写，逐条保留出处括注。

### 修复

- 修正既有条目 `zhanguo-13 徐州相王` 的事实错误：会盟双方由「魏襄王与齐王」更正为「**魏惠王与齐威王**」（前 334 年，魏襄王尚未即位）。

### 文档

- `timeline-events.ts` 更新数据来源与批次说明（新增「第 3 批 · V0.5 春秋战国补遗」）。

---

## [0.4.1] - 2026-11-18

> 版本主题：**秦汉人物 2D 关系图**。

### 新增

- 新增 `/graph` 页面：基于 D3 `forceSimulation` + SVG 的 2D 力导向人物关系图。
- 新增 `frontend/data/person-graph.ts`：把带 `participants` 的时间轴事件自动转换为人物节点与无向关系边（同事件参与者两两成边；边权重 = 共同参与事件数；`sharedEvents` 直接保存可展示的共同事件）。
- 秦汉 **122 条事件**的参与者索引（`timeline-participants.ts`）。
- 交互：单击相邻人物在右栏查看其与当前中心人物的共同事件（不改变中心）；长按约 500ms 切换中心；拖拽节点调整位置；键盘 Enter / 空格查看详情。
- 性能与资源：关系数据在模块加载时一次性预处理（读取任意边的共同事件为 O(1)）；组件卸载或切换中心时停止力模拟，避免遗留动画任务。

### 文档

- README 补充 V0.4.1 人物图说明与交互口径。

### 验证

- 人工验收通过：单击查看详情、长按切换中心、拖拽布局均正常。

---

## [0.4.0] - 2026-11-18

> 版本主题：**全朝代时间轴验收与体验完善**。

### 新增

- 时间轴交互完善：圆点按年份线性映射后自动上下错层（贪心分层的垂直偏移，偏移符号交替），解决密集年份圆点互相遮挡的问题。
- 轨道高度随错层深度动态计算（148–440px），保证圆点与年份标签不被裁切。
- 密集朝代（事件 > 40 条或错层 ≥ 4 层）自动缩小圆点，缓解视觉拥挤（点击热区不变）。
- 窄屏时轨道最小宽度 680px 并允许横向滚动，保证点与点之间仍有足够像素间距。
- 朝代 Tab 由数据自动推导并按起始年排序（不硬编码列表）。
- 时间轴页脚加入数据来源署名（CC BY-NC-SA 4.0 / CC0）。

### 数据

- 全朝代时间轴数据完备：夏—战国 136 条 + 秦汉 122 条 = **258 条**事件。

### 变更

- 事件详情由原地卡片展示，点击空白处收起；年份展示统一由 `lib/year.ts` 的 `formatYear()` 输出。

### 验证

- V0.4 验收通过：全朝代时间轴可切换、圆点错层不遮挡、事件详情可查看。

---

## [0.3.0] - 2026-11-18

> 版本主题：**秦汉时间轴扩容**（第 2 批数据）。

### 新增

- 新增秦汉事件 **112 条**（秦 30、西汉 46、东汉 36），连同首版 10 条秦汉种子数据，秦汉合计 122 条。
- 事件描述以《汉书》《后汉书》原文（公有领域）为依据撰写；年号与公元纪年参照 chinese-history（事实数据 CC0）与《资治通鉴》交叉校验。

### 数据

- 时间轴覆盖范围扩展至东汉末年（220 年曹丕代汉）。

---

## [0.2.0] - 2026-11-18

> 版本主题：**全朝代时间轴**（第 1 批数据与时间轴页面）。

### 新增

- 新增 `/timeline` 时间轴页面：按朝代切换，事件以圆点分布在时间轨道上，点击查看详情卡。
- 新增夏—战国 **136 条**精选事件数据（史记知识库 shiji-kb 章节事件索引，按朝代年份窗筛选、跨章去重后精选；夏、商年代依夏商周断代工程推定）。
- 新增年份工具模块 `frontend/lib/year.ts`：天文纪年换算（`A(y) = y < 0 ? y + 1 : y`）、公元 0 年非法校验、史书纪年格式化。

---

## [0.1.0] - 2026-11-17

> 版本主题：**全栈骨架**。

### 新增

- Next.js（App Router）+ React + TypeScript 前端骨架；FastAPI（Python）后端骨架，前后端分离。
- 首页模块入口（聊天问答 / 时间轴 / 人物关系图占位）与后端连通状态检测。
- 后端 `GET /api/health` 健康检查端点；CORS 仅放行本地前端来源。
- Windows 一键启动 / 停止脚本（`启动史脉.cmd`、`停止史脉.cmd`、`scripts/launch.ps1`、`scripts/stop.ps1`）：依赖检查、双服务启动、健康等待、日志聚合与按端口精确停止。
- 项目需求与验收标准文档 `SPEC.md`。

### 数据

- 首版 10 条秦汉种子事件（统一六国、焚书坑儒、陈胜吴广起义、刘邦建汉、七国之乱、张骞出使西域、西域都护府、王莽篡汉、蔡伦造纸、黄巾起义）。
