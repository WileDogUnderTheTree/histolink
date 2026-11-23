"""史脉 HistoLink · FastAPI 后端入口（V1.0.1 只读数据服务）。

V1.0.1 职责：
- 启动时一次性加载 `backend/data/snapshot.v1.json`（schema/counts/hash 校验失败即拒绝启动）；
- 提供只读接口：`/api/health`、`/api/meta`、`/api/entities/*`；
- **无任何写接口**：错误统一走 `{ok:false, request_id, error:{code,message,retryable}}` envelope；
- 保留 `main:app` 入口，`scripts/launch.ps1` 无需改动。

CORS 说明（内测分享的关键）：
- 默认放行本机前端 3000 端口，以及任意局域网 / 私有网段的任意端口：
  朋友用 `http://<你的局域网 IP>:3000` 打开前端时，即使浏览器直连 8000 也能通过。
- 若前端通过 Next 的同源 `/api` 代理访问后端（V0.9.0 默认方式），浏览器根本不跨域，
  所以分享到 UUMit 等公网隧道时**通常不需要改 CORS**，且只需暴露前端 3000 端口。
- 只有「浏览器直连后端」时才需要把前端地址显式加入白名单，例如：

      ALLOW_ORIGINS=https://app-3000--xxx.uua2a.com uvicorn main:app --host 0.0.0.0 --port 8000

- 正式环境建议显式设置 ALLOW_ORIGINS，并置空 ALLOW_ORIGIN_REGEX 关闭私有网段放行：

      $env:ALLOW_ORIGIN_REGEX = ""

环境变量（可选）：
- `SNAPSHOT_PATH` / `SNAPSHOT_META_PATH`：覆盖默认快照路径（默认 backend/data/snapshot.v1.json）。
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from errors import install_error_handlers, read_only_violation_response
from routers import register_routes
from snapshot_store import SnapshotLoadError, SnapshotStore

APP_VERSION = "1.0.1"

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_SNAPSHOT_PATH = BASE_DIR / "data" / "snapshot.v1.json"
DEFAULT_SNAPSHOT_META_PATH = BASE_DIR / "data" / "snapshot.meta.json"

# 本机前端默认来源
DEFAULT_ALLOW_ORIGINS = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)

# 局域网 / 私有网段（允许任意端口）：朋友用 http://192.168.x.x:3000 访问时，
# 若浏览器直连 8000，Origin 会是这个私网地址。
DEFAULT_ALLOW_ORIGIN_REGEX = (
    r"^https?://("
    r"localhost|127\.0\.0\.1|"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"192\.168\.\d{1,3}\.\d{1,3}|"
    r"172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
    r")(?::\d+)?$"
)


def _split_env(name: str) -> list[str]:
    """读取逗号分隔的环境变量，去掉空白与末尾斜杠。"""

    raw = os.environ.get(name, "")
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


def _snapshot_paths() -> tuple[Path, Path]:
    snapshot = Path(os.environ.get("SNAPSHOT_PATH", str(DEFAULT_SNAPSHOT_PATH))).expanduser()
    meta = Path(os.environ.get("SNAPSHOT_META_PATH", str(DEFAULT_SNAPSHOT_META_PATH))).expanduser()
    return snapshot, meta


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时加载快照；失败即拒绝启动（fail-fast），避免“看似健康但数据为空”。"""

    snapshot_path, meta_path = _snapshot_paths()
    try:
        store = SnapshotStore.load(snapshot_path, meta_path)
    except SnapshotLoadError as exc:
        raise RuntimeError(f"数据快照加载失败，服务拒绝启动：{exc}") from exc

    app.state.store = store
    app.state.snapshot_path = snapshot_path
    try:
        yield
    finally:
        app.state.store = None


def create_app() -> FastAPI:
    """应用工厂；测试可重复创建，生产使用模块级 `app`。"""

    application = FastAPI(
        title="史脉 HistoLink API",
        version=APP_VERSION,
        description="V1.0.1 只读数据服务：快照 meta / 人物 / 事件 / 姓名候选。",
        lifespan=lifespan,
    )

    allow_origins = _split_env("ALLOW_ORIGINS") or list(DEFAULT_ALLOW_ORIGINS)
    # 显式设置为空字符串即关闭「私有网段通配」放行
    allow_origin_regex = os.environ.get("ALLOW_ORIGIN_REGEX", DEFAULT_ALLOW_ORIGIN_REGEX).strip()

    application.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_origin_regex=allow_origin_regex or None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    install_error_handlers(application)

    # 只读闸门：V1.0.1 的 /api 不提供任何写接口（POST /api/agent/ask 属 V1.0.3）。
    # 放在路由之前统一拦截，保证 405 也走 ErrorEnvelope，而不是 Starlette 默认 detail。
    read_only_methods = {"POST", "PUT", "PATCH", "DELETE"}

    @application.middleware("http")
    async def enforce_read_only(request, call_next):  # type: ignore[no-untyped-def]
        if request.method in read_only_methods and request.url.path.startswith("/api"):
            return read_only_violation_response()
        return await call_next(request)

    register_routes(application, APP_VERSION)
    return application


app = create_app()
