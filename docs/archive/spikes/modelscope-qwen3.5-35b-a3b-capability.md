# ModelScope · Qwen/Qwen3.5-35B-A3B 能力报告（TC-10）

> 更新：2026-11-23
> 状态：**已实测通过**（连通性 / JSON / tool calling / 流式 / 中文回答 / 确定性 / 思考开关）
> 凭据：`backend/.env` 的 `MODELSCOPE_API_KEY` / `MODELSCOPE_BASE_URL` / `MODELSCOPE_MODEL`（仅本地，不入库）
> 执行人：实施工程师（本机直连）
> 复现方式：[README.md](README.md)
> 模型名：`Qwen/Qwen3.5-35B-A3B`（用户已先期实测成功；本报告为仓库内可复现的完整复测）

## 0. 当前结论

- **连通性 PASS**：4 次重复调用均返回真实回复 `OK`，`usage` 正常；单次 total_tokens 174–251（与用户实测 248 tokens 同一量级）。
- **JSON 模式 PASS**：`response_format={"type":"json_object"}` 返回内容可被 `JSON.parse` 直接解析。
- **tool calling PASS**：`tools` + `tool_choice=auto` 正确返回 `tool_calls`，入参 `{"event_id": "qin-unify"}` 与 schema 一致。
- **流式 SSE PASS**：首字约 **0.52s**（非思考模式），完整回答约 9.4s；250 个 chunk，`finish_reason=stop`。
- **中文回答 PASS**：思考模式 212 字、68.7s、6341 tokens（其中 reasoning 6152）；关闭思考后 184 字、2.36s、165 tokens，均带《史记·秦始皇本纪》出处。
- **重要发现**：该模型默认开启思考（reasoning）。默认模式下 `max_tokens=64` 的 ping 仍消耗 174–251 completion tokens，且 `max_tokens=400` 的中文回答实际用了 6281 completion tokens——**`max_tokens` 不约束 reasoning tokens**。生产链路必须显式 `enable_thinking=false`（或按 reasoning 预算留足超时）。
- **V1.0.3 路线建议**：采用 **tool calling 为主 + JSON 模式兜底**；意图抽取与规划默认 `enable_thinking=false`，仅长文解释型回答按需开启思考；流式输出直接可用。

## 1. 实测环境

| 项 | 值 |
|---|---|
| 时间 | 2026-11-23（Asia/Shanghai） |
| 模型 | `Qwen/Qwen3.5-35B-A3B` |
| 网关 | `https://api-inference.modelscope.cn/v1`（OpenAI 兼容） |
| 网络 | 本机直连，无代理 |
| 客户端 | `backend/llm_client.py`（httpx，`LLM_TIMEOUT_SECONDS=30`）+ 独立探针脚本 |
| 凭据读取 | `backend/.env`；key 脱敏后仅显示 `ms***86`，未写入任何输出 |

## 2. 探针结果

| # | 探针 | 结果 | 证据 / 备注 |
|---|---|---|---|
| 1 | OpenAI 兼容 `/chat/completions` | **PASS** | 4/4 成功；回复 `OK`；total_tokens 174–184（另一次思考模式复测 251） |
| 2 | `response_format=json_object` | **PASS** | 返回 `{"answer":"OK","score":1}`；218 tokens / 3.35s；JSON 解析成功 |
| 3 | tool / function calling | **PASS** | 返回 1 个 `get_event` 调用，`arguments={"event_id": "qin-unify"}`；360 tokens / 1.35s |
| 4 | 流式 SSE / 首字延迟 | **PASS** | 首字 **515ms**，总耗时 9354ms，250 chunks，`finish_reason=stop`；回复「赤壁之战发生在公元 208 年。」 |
| 5 | 上下文上限 / 8 片段稳定性 | **PARTIAL** | 本轮请求 prompt 13–291 tokens 全部稳定；未做上下文上限压测与 8 片段长上下文实测（留 V1.0.5） |
| 6 | 中文 150–400 字回答质量 | **PASS（单题样本）** | 思考模式 212 字 / 68.7s；关闭思考 184 字 / 2.36s；两版均引用《史记·秦始皇本纪》 |
| 7 | 确定性与延迟 | **PASS（小样本）** | 同 prompt 4 次回复均为 `OK`；延迟 2335/2543/2728/2764ms（mean 2593ms / median 2636ms / max 2764ms / std ≈171ms） |
| 8 | 429 / 5xx 行为与重试 | **N/A（未触发）** | 本轮未遇到限流；客户端对 429/5xx 的 retryable 映射已有离线单测覆盖 |
| 9 | 单次问答成本 | **PARTIAL** | token 用量已实测（如非思考中文 165 tokens、思考中文 6341 tokens）；单价需以 ModelScope 计费页为准，本报告不臆测金额 |
| 10 | 数据合规（出境 / 日志） | **待确认** | 需向提供方确认；数据本身为公有领域 / CC BY-NC-SA 4.0 公开史料 |

## 3. 连通性记录

`GET /api/agent/ping_llm`（FastAPI TestClient，真实上游）返回：

```json
{
  "ok": true,
  "message": "请回复 OK",
  "reply": "OK",
  "model": "Qwen/Qwen3.5-35B-A3B",
  "latency_ms": 2441,
  "usage": { "prompt_tokens": 13, "completion_tokens": 162, "total_tokens": 175 }
}
```

独立探针 `backend/scripts/spike_llm.py` 的 4 次重复调用（`temperature=0`）：

| 次数 | 回复 | latency_ms | prompt | completion | total |
|---:|---|---:|---:|---:|---:|
| 1 | OK | 2728 | 13 | 171 | 184 |
| 2 | OK | 2764 | 13 | 165 | 178 |
| 3 | OK | 2543 | 13 | 166 | 179 |
| 4 | OK | 2335 | 13 | 161 | 174 |

> 用户先期实测的 **248 tokens** 与本报告「思考模式基线」复测的 **251 tokens** 基本一致；
> 差异来自每次 reasoning tokens 长度不同（模型默认 thinking，reasoning 不计入可见回复，但计入 completion）。
> `ping_llm` 端点返回的 `usage` 只保留 `prompt/completion/total` 三个标准字段，不含 reasoning 明细。

## 4. 关键发现

### 4.1 默认开启思考，`max_tokens` 不限制 reasoning

同一句「请回复 OK」：

| 配置 | 回复 | total tokens | latency_ms |
|---|---|---:|---:|
| 默认（thinking on） | OK | 251 | 3471 |
| 顶层 `enable_thinking=false` | OK | **16** | **732** |
| `chat_template_kwargs.enable_thinking=false` | OK | 16 | 686 |
| `reasoning_effort="none"` | OK | 16 | 904 |
| `extra_body.enable_thinking=false` | OK | 178 | 2263 |

结论：**顶层 `enable_thinking=false` 生效**（`chat_template_kwargs` / `reasoning_effort` 也可）；
`extra_body` 里的同名参数不会被网关识别。中文长回答默认思考模式下
`max_tokens=400` 实际产生 6281 completion tokens（6152 reasoning）→ **不能靠 `max_tokens` 控制耗时与成本**。

### 4.2 JSON / tool calling / SSE 均可用

- JSON 模式返回严格 JSON，可直接进 Pydantic 校验；
- tool calling 返回标准 OpenAI 形状 `choices[0].message.tool_calls[]`，适合做规划器；
- SSE 流式可逐块拼接，非思考模式首字 < 1s。

### 4.3 非思考模式的中文质量

关闭思考后「秦始皇统一六国的历史意义」：184 字 / 2.36s / 165 tokens，
结构完整、结论准确，并主动补「依据：《史记·秦始皇本纪》」。用于 V1.0.3 的默认回答生成足够，
但事实一致性仍需 V1.0.5 的引用校验兜底。

## 5. 对 V1.0.3 的建议（已按实测修订）

1. **规划器采用 tool calling 为主、JSON 意图抽取兜底**：模型对 8 个只读工具的调用格式稳定；
   若某次未返回 tool_calls，则退化为「单次 JSON 意图抽取 + 服务端规则执行」。
2. **默认 `enable_thinking=false`**：意图抽取 / 工具规划 / 短回答都关闭思考；
   仅「对比类长文解释」按需开启，且必须把超时提到 **90–120s**（本轮思考中文回答 68.7s）。
3. **参数建议**：`temperature=0`（规划）/ `0.2–0.4`（回答）；`max_tokens` 只约束可见输出，
   并额外预留 reasoning 预算；`LLM_TIMEOUT_SECONDS=30` 仅适合非思考模式。
4. **流式回答**：V1.0.4 起直接用 SSE 渲染，首字延迟满足「思考中 → 逐字输出」体验。
5. **重试**：仅对 429/5xx/网络错误重试 1 次（指数退避）；4xx 鉴权错误不重试。
6. **成本**：以 `usage.total_tokens` 记账（含 reasoning）；非思考短问答约 165 tokens，
   思考模式可能放大 30–40 倍，必须在配置层限制何时开启。
7. **数据合规**：向 ModelScope 确认请求日志策略后再决定是否进入内测分享链路；本仓库不记录 key。

## 6. 安全与合规

- 仓库中无真实 key：key 只存在于本地 `backend/.env`（`.gitignore` 已忽略）；
- 所有错误信息经 `_safe_excerpt` 脱敏；探针只打印 `ms***86` 形式的掩码；
- 输出只含模型名、回复、耗时与 usage，不含请求头 / key；
- 数据仅为公开史料摘要（公有领域 + CC BY-NC-SA 4.0），非商业用途。

## 7. 复现命令

```powershell
cd backend

# 1) 独立探针（不启动服务）
.\.venv\Scripts\python scripts\spike_llm.py

# 2) 服务端点
.\.venv\Scripts\python -m uvicorn main:app --port 8000
curl http://127.0.0.1:8000/api/agent/ping_llm

# 3) 离线回归（不访问网络）
.\.venv\Scripts\python -m pytest tests\test_llm_client.py tests\test_agent_ping.py -q
```
