"""史脉 HistoLink · FastAPI 后端入口（V0.9.0 内测版）。

CORS 说明（内测分享的关键）：
- 默认放行本机前端 3000 端口，以及任意局域网 / 私有网段的任意端口：
  朋友用 `http://<你的局域网 IP>:3000` 打开前端时，即使浏览器直连 8000 也能通过。
- 若前端通过 Next 的同源 `/api` 代理访问后端（V0.9.0 默认方式），浏览器根本不跨域，
  所以分享到 UUMit 等公网隧道时**通常不需要改 CORS**，且只需暴露前端 3000 端口。
- 只有「浏览器直连后端」时才需要把前端地址显式加入白名单，例如：

      ALLOW_ORIGINS=https://app-3000--xxx.uua2a.com uvicorn main:app --host 0.0.0.0 --port 8000

- 正式环境建议显式设置 ALLOW_ORIGINS，并置空 ALLOW_ORIGIN_REGEX 关闭私有网段放行：

      $env:ALLOW_ORIGIN_REGEX = ""
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

APP_VERSION = "0.9.0"

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


allow_origins = _split_env("ALLOW_ORIGINS") or list(DEFAULT_ALLOW_ORIGINS)
# 显式设置为空字符串即关闭「私有网段通配」放行
allow_origin_regex = os.environ.get("ALLOW_ORIGIN_REGEX", DEFAULT_ALLOW_ORIGIN_REGEX).strip()

app = FastAPI(title="Chinese History Explorer API", version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_origin_regex=allow_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, object]:
    return {"ok": True, "version": APP_VERSION}
