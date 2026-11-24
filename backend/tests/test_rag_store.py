from __future__ import annotations

import chromadb

from rag.store import create_chroma_client


def test_create_chroma_client_uses_http_when_configured(monkeypatch) -> None:
    expected_client = object()
    received: dict[str, object] = {}

    def fake_http_client(**kwargs):
        received.update(kwargs)
        return expected_client

    monkeypatch.setattr(chromadb, "HttpClient", fake_http_client)
    monkeypatch.setenv("RAG_CHROMA_HTTP_HOST", "127.0.0.1")
    monkeypatch.setenv("RAG_CHROMA_HTTP_PORT", "8123")

    client = create_chroma_client()

    assert client is expected_client
    assert received == {"host": "127.0.0.1", "port": 8123}


def test_create_chroma_client_defaults_to_persistent(monkeypatch, tmp_path) -> None:
    expected_client = object()
    received: dict[str, object] = {}

    def fake_persistent_client(**kwargs):
        received.update(kwargs)
        return expected_client

    monkeypatch.setattr(chromadb, "PersistentClient", fake_persistent_client)
    monkeypatch.delenv("RAG_CHROMA_HTTP_HOST", raising=False)
    monkeypatch.delenv("RAG_CHROMA_HTTP_PORT", raising=False)

    client = create_chroma_client(tmp_path)

    assert client is expected_client
    assert received == {"path": str(tmp_path)}
