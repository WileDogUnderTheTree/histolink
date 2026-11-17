# 中国历史探索（Chinese History Explorer）

最小全栈骨架：只有导航占位与健康检查，无任何业务逻辑（见 `SPEC.md`）。

## 目录

- `frontend/` — Next.js（App Router）+ React + TypeScript，端口 3000
- `backend/` — FastAPI（Python），端口 8000

## 启动

后端：

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

前端：

```bash
cd frontend
pnpm install
pnpm dev
```

打开 <http://localhost:3000>，右下角显示「后端已连接」。

## 端点

| 方法 | 路径 | 响应 |
|---|---|---|
| GET | `/api/health` | `{"ok": true}` |

CORS 仅放行 `http://localhost:3000` 与 `http://127.0.0.1:3000`。
