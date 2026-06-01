from types import SimpleNamespace

from api.services.configuration.registry import ServiceProviders
from api.services.gen_ai.embedding.factory import (
    create_embedding_service,
    resolve_embedding_settings,
)
from api.services.gen_ai.embedding.google_service import GoogleEmbeddingService


def test_resolve_embedding_settings_uses_explicit_embeddings():
    config = SimpleNamespace(
        embeddings=SimpleNamespace(
            provider=ServiceProviders.OPENROUTER,
            api_key="embed-key",
            model="openai/text-embedding-3-small",
            base_url="https://openrouter.ai/api/v1",
        ),
        realtime=SimpleNamespace(
            provider=ServiceProviders.GOOGLE_REALTIME,
            api_key="realtime-key",
        ),
    )

    settings = resolve_embedding_settings(config)

    assert settings == {
        "provider": "openrouter",
        "api_key": "embed-key",
        "model": "openai/text-embedding-3-small",
        "base_url": "https://openrouter.ai/api/v1",
    }


def test_resolve_embedding_settings_falls_back_to_google_realtime_key():
    config = SimpleNamespace(
        embeddings=SimpleNamespace(
            provider=ServiceProviders.OPENAI,
            api_key="",
            model="text-embedding-3-small",
            base_url=None,
        ),
        realtime=SimpleNamespace(
            provider=ServiceProviders.GOOGLE_REALTIME,
            api_key="realtime-key",
        ),
    )

    settings = resolve_embedding_settings(config)

    assert settings == {
        "provider": "google",
        "api_key": "realtime-key",
        "model": "gemini-embedding-001",
        "base_url": None,
    }


def test_create_embedding_service_accepts_service_provider_enum():
    service = create_embedding_service(
        db_client=SimpleNamespace(),
        provider=ServiceProviders.GOOGLE,
        api_key=None,
        model=None,
    )

    assert isinstance(service, GoogleEmbeddingService)
