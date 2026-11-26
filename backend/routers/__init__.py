"""路由包（V1.0.1 / TC-06 + TC-10；V1.0.3 问答入口；V1.0.6 会话管理）。"""

from __future__ import annotations

from fastapi import FastAPI

from routers import agent, entities, health, meta, sessions


def register_routes(app: FastAPI, app_version: str) -> None:
    """挂载全部路由；除问答入口与会话管理外均为只读。"""

    app.include_router(health.register(app_version))
    app.include_router(meta.router)
    app.include_router(entities.router)
    app.include_router(agent.router)
    app.include_router(sessions.router)
