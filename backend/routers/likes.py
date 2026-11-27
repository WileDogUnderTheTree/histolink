"""点赞计数路由（V1.0.8 · 左下角点赞悬浮组件）。

接口（V1.0 内**只增不改**，与 `contracts/api-v1.openapi.json` 同步）：

- `GET  /api/likes`：返回当前总点赞数（文件不存在时由 `LikesStore` 自动创建 `{"count": 0}`）；
- `POST /api/likes`：点赞数 +1 并返回最新总数。

写入边界（`main.py` 的只读闸门）：
- 本文件是 `/api` 下 V1.0.8 新增的**唯一写入口**（`POST /api/likes` 已加入 write_allowlist）；
- 计数是全局匿名计数，不接收请求体、不记录用户维度；前端防刷依赖
  `localStorage.has_liked_shimai`（同一浏览器只允许点一次）。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from contracts.models import LikeCountResponse
from likes_store import LikesStore
from routers.deps import get_likes_store

router = APIRouter(tags=["likes"])


@router.get("/api/likes", response_model=LikeCountResponse)
def read_likes(
    store: Annotated[LikesStore, Depends(get_likes_store)],
) -> LikeCountResponse:
    """当前总点赞数。"""

    return LikeCountResponse(count=store.count())


@router.post("/api/likes", response_model=LikeCountResponse)
def add_like(
    store: Annotated[LikesStore, Depends(get_likes_store)],
) -> LikeCountResponse:
    """点赞数 +1 并返回最新总数。"""

    return LikeCountResponse(count=store.increment())


__all__ = ["router"]