"""点赞计数存储（V1.0.8 · 左下角「点赞」悬浮组件的后端）。

职责
----
- 单文件 JSON 持久化：默认 `backend/data/likes.json`，内容形如 ``{"count": 0}``；
- 文件不存在时**自动创建**（首次启动 / 首次访问即落盘，count=0）；
- 文件损坏 / 内容非法时按 0 重置并记 warning，绝不因为坏文件让点赞接口 500；
- 并发安全：进程内 ``RLock`` 串行化「读 → 自增 → 写」，写入用临时文件 + ``os.replace``
  原子替换，避免写到一半进程退出导致 JSON 截断。

设计选择
--------
- 点赞数属于**低价值计数**而不是账本：不记录用户维度、不要求强一致，单进程低并发足够；
- 前端有 `localStorage.has_liked_shimai` 防刷，后端只保证「每次 POST +1」的语义；
- 测试 / 自动化可用 ``path=":memory:"`` 关闭落盘，或注入临时文件路径。

环境变量
--------
``LIKES_PATH``：覆盖点赞计数文件路径（默认 `backend/data/likes.json`；
``:memory:`` 表示只存内存，用于自动化测试 / 探针）。
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any

logger = logging.getLogger("histolink.likes")

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_LIKES_PATH = BASE_DIR / "data" / "likes.json"
LIKES_PATH_ENV = "LIKES_PATH"
MEMORY_PATH = ":memory:"
#: 计数器上限：防止异常写入把数字撑到不可展示（正常使用永远到不了）。
MAX_LIKES_COUNT = 1_000_000_000


def normalize_like_count(value: Any) -> int:
    """把任意输入规整成合法点赞数（非负整数，越界钳制，非法值按 0）。"""

    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return max(0, min(value, MAX_LIKES_COUNT))


class LikesStore:
    """点赞计数存储（JSON 文件；`:memory:` 时只保存在进程内）。

    参数 ``path`` 为空时读取环境变量 ``LIKES_PATH``，再回退到
    `backend/data/likes.json`。构造时即完成「读取 → 缺文件自动创建」。
    """

    def __init__(self, path: str | Path | None = None) -> None:
        raw: str | Path = path if path is not None else os.environ.get(LIKES_PATH_ENV)
        if raw is None or str(raw).strip() == "":
            raw = DEFAULT_LIKES_PATH
        self._memory = str(raw).strip() == MEMORY_PATH
        self._path: Path | None = None if self._memory else Path(raw).expanduser()
        self._lock = threading.RLock()
        self._count = 0
        if self._path is not None:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._count = self._read_count()

    # -- 只读属性 -----------------------------------------------------
    @property
    def path(self) -> str:
        """落盘路径（内存模式返回 `:memory:`，供日志 / 测试断言）。"""

        return MEMORY_PATH if self._path is None else str(self._path)

    @property
    def is_memory(self) -> bool:
        return self._path is None

    # -- 读写 ---------------------------------------------------------
    def count(self) -> int:
        """当前总点赞数。"""

        with self._lock:
            return self._count

    def increment(self) -> int:
        """点赞数 +1 并返回最新总数（原子写盘；写盘失败仍返回内存中的新值）。"""

        with self._lock:
            self._count = normalize_like_count(self._count + 1)
            self._write_count(self._count)
            return self._count

    def reset(self, count: int = 0, *, persist: bool = True) -> int:
        """重置计数（运维 / 测试用；默认同步落盘）。"""

        with self._lock:
            self._count = normalize_like_count(count)
            if persist:
                self._write_count(self._count)
            return self._count

    # -- 内部 ---------------------------------------------------------
    def _read_count(self) -> int:
        path = self._path
        if path is None:  # pragma: no cover - 内存模式不会走到
            return 0
        try:
            raw = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            # 首次访问：自动创建 `{"count": 0}`（需求要求文件不存在则自动创建）。
            self._write_count(0)
            return 0
        except OSError as exc:  # pragma: no cover - 磁盘异常（只读目录 / 权限）
            logger.warning("点赞计数文件读取失败（%s），本次按 0 处理：%s", path, exc)
            return 0
        try:
            payload: Any = json.loads(raw)
        except (TypeError, ValueError):
            logger.warning("点赞计数文件不是合法 JSON，已重置为 0：%s", path)
            self._write_count(0)
            return 0
        count = payload.get("count") if isinstance(payload, dict) else payload
        normalized = normalize_like_count(count)
        if isinstance(count, dict) or not isinstance(count, int):
            logger.warning("点赞计数文件结构异常，已按 %d 归一化：%s", normalized, path)
            self._write_count(normalized)
        return normalized

    def _write_count(self, count: int) -> None:
        path = self._path
        if path is None:
            return
        tmp = path.with_name(f"{path.name}.tmp")
        try:
            tmp.write_text(
                json.dumps({"count": normalize_like_count(count)}, ensure_ascii=False)
                + "\n",
                encoding="utf-8",
            )
            os.replace(tmp, path)
        except OSError:  # pragma: no cover - 磁盘异常不影响接口返回
            logger.exception("点赞计数写盘失败：%s", path)
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass


__all__ = [
    "DEFAULT_LIKES_PATH",
    "LIKES_PATH_ENV",
    "MAX_LIKES_COUNT",
    "MEMORY_PATH",
    "LikesStore",
    "normalize_like_count",
]