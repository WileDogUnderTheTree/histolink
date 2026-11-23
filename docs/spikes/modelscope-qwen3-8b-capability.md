# ModelScope · Qwen/Qwen3-8B 能力报告（TC-10）

> 更新：2026-11-23
> 状态：**连通性代码与端点完成；真实连通性待凭据填入后执行（blocked by credential）**
> 凭据：`backend/.env` 的 `MODELSCOPE_API_KEY` / `MODELSCOPE_BASE_URL` / `MODELSCOPE_MODEL`
> 执行人：待填；复现方式见 [README.md](README.md)

## 0. 当前结论

- 已实现 `backend/llm_client.py`（OpenAI 兼容最小客户端）+ `GET /api/agent/ping_llm` + `backend/scripts/spike_llm.py`；
- 离线测试（httpx.MockTransport）覆盖：成功、超时、401/429/5xx、非法 JSON、缺 content、错误脱敏、配置缺失 → 全部通过；
- **真实请求尚未执行**：本次检查时 `backend/.env` 与 `.env.example` 均为 0 字节，
  没有可用的 key；因此下表 §1 的 PASS/FAIL 先留空，等 `spike_llm.py` 跑通后补。

## 1. 探针结果

| # | 探针 | 结果 | 证据 / 备注 |
|---|---|---|---|
| 1 | OpenAI 兼容：`/v1/chat/completions` | ⏳ 待执行 | `spike_llm.py` 输出 `reply` / `model` / `latency_ms` |
| 2 | `response_format=json_object` | ⏳ 待执行 | 需单独脚本扩展（当前 ping 不带 response_format） |
| 3 | tool / function calling | ⏳ 待执行 | 决定 V1.0.3 用 tool calling 还是 JSON 意图抽取 |
| 4 | 流式 SSE / 首字延迟 | ⏳ 待执行 | 影响 V1.0.4 流式回答 |
| 5 | 上下文上限 / 8 片段稳定性 | ⏳ 待执行 | 与 V1.0.5 检索片段数相关 |
| 6 | 中文 150–400 字回答质量（10 题） | ⏳ 待执行 | 固定题集跑 3 次人工评分 |
| 7 | 确定性与 P50/P95 延迟 | ⏳ 待执行 | 同 prompt 3 次；记录 mean/std |
| 8 | 429 / 5xx 行为与重试建议 | ⏳ 待执行 | 客户端已区分 retryable |
| 9 | 单次问答成本 | ⏳ 待执行 | 用 `usage` 字段估算 |
| 10 | 数据合规（出境 / 日志） | ⏳ 待执行 | 需向提供方确认 |

## 2. 连通性记录（首次真实调用后填写）

```json
{
  "ok": true,
  "message": "请回复 OK",
  "reply": "<模型真实回复>",
  "model": "Qwen/Qwen3-8B",
  "latency_ms": 0,
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
}
```

- 实测时间：待填
- base URL（脱敏）：`https://api-inference.modelscope.cn/v1`
- 网络环境：本机直连 / 代理（待填）

## 3. 对 V1.0.3 的初步建议（待 §1 完成后修订）

- 先按「无 tool calling 也能跑」设计：单次 JSON 意图抽取 + 服务端规则执行为兜底；
- 超时建议 30 秒（配置项已支持 `LLM_TIMEOUT_SECONDS`），最多重试 1 次；
- 所有回答必须经过引用校验（Q4），ping 接口不参与问答链路。
