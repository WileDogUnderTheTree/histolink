"""Agent 层（V1.0.2 起）：只读工具层，后续 V1.0.3 规划器接在这里。

本包只依赖内存中的快照与 Pydantic 契约，**不发起任何 HTTP 请求**，也不访问数据库。
"""

from __future__ import annotations

__all__ = ["tools"]
