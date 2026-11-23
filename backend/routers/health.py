"""`GET /api/health`（V1.0.1 / TC-06）。"""

from __future__ import annotations

from fastapi import APIRouter

from contracts.models import HealthResponse

router = APIRouter(tags=["meta"])


def register(app_version: str) -> APIRouter:
    @router.get("/api/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(version=app_version)

    return router
