# 模型能力 spike（TC-10）· 复现说明

> 状态：连通性代码与端点已就绪（2026-11-23）；**真实调用等待 `backend/.env` 填入 ModelScope key**。
> 本目录只放脱敏后的结论与证据，**不得出现真实 key / 完整内网地址**。

## 1. 配置

```powershell
Copy-Item backend\.env.example backend\.env
# 编辑 backend\.env：
#   MODELSCOPE_API_KEY=……
#   MODELSCOPE_BASE_URL=https://api-inference.modelscope.cn/v1
#   MODELSCOPE_MODEL=Qwen/Qwen3-8B
```

变量别名（按顺序取第一个非空）：

| 用途 | 变量名 |
|---|---|
| 密钥 | `MODELSCOPE_API_KEY` / `MODELSCOPE_KEY` / `LLM_API_KEY` / `OPENAI_API_KEY` |
| 地址 | `MODELSCOPE_BASE_URL` / `MODELSCOPE_URL` / `LLM_BASE_URL` / `OPENAI_BASE_URL` |
| 模型 | `MODELSCOPE_MODEL` / `LLM_MODEL` / `OPENAI_MODEL` |
| 超时 | `LLM_TIMEOUT_SECONDS` / `MODELSCOPE_TIMEOUT_SECONDS`（默认 30 秒） |

安全：key 只放 `backend/.env` 或系统环境变量；`.env` 已被 `.gitignore` 忽略；接口与脚本只打印脱敏值。

## 2. 复现命令

```powershell
cd backend

# A. 独立探针（直接打网关，不经过 FastAPI）
.\.venv\Scripts\python scripts\spike_llm.py
.\.venv\Scripts\python scripts\spike_llm.py --message "请回复 OK"

# B. 服务端点（起服务后）
.\.venv\Scripts\python -m uvicorn main:app --reload --port 8000
curl http://127.0.0.1:8000/api/agent/ping_llm

# C. 离线回归（不访问网络）
.\.venv\Scripts\python -m pytest tests/test_llm_client.py tests/test_agent_ping.py -q
```

## 3. 失败码对照

| 退出码 / HTTP | 含义 | 处理 |
|---|---|---|
| 脚本 2 / HTTP 503 `LLM_NOT_CONFIGURED` | 没读到 key / URL 非法 | 检查 `backend/.env` 是否保存、变量名是否拼错 |
| 脚本 3 / HTTP 502 `LLM_UPSTREAM_ERROR` | 网关非 2xx、鉴权失败、响应格式异常 | 看 `error.message` 的 HTTP 状态；401 多为 key/权限，429/5xx 可重试 |
| 脚本 4 / HTTP 504 `LLM_TIMEOUT` | 超时 | 调大 `LLM_TIMEOUT_SECONDS`，检查网络 |
| HTTP 400 `INVALID_REQUEST` | `message` 为空或超过 200 字 | 使用默认或 ≤200 字测试语句 |

## 4. 探针清单（进度见 `modelscope-qwen3-8b-capability.md`）

1. OpenAI 兼容性（`/v1/models`、`/v1/chat/completions`）
2. `response_format=json_object` 支持与非法 JSON 比例
3. tool / function calling 支持与参数稳定性
4. 流式 SSE 与首字延迟
5. 上下文上限与 8 条检索片段稳定性
6. 中文 150–400 字历史回答的可读性与事实一致性（固定 10 题）
7. 确定性与 P50/P95 延迟（同 prompt 3 次）
8. 429 / 5xx 限流行为与重试建议
9. 单次问答成本估算
10. 数据合规（是否出境 / 日志可关闭）

> 原则：先有结论再写规划器。若模型不支持 tool calling / JSON 模式，V1.0.3 采用
> 「单次 JSON 意图抽取 + 规则执行」的降级路线（见报告 §5.8）。
