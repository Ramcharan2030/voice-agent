"""Embedding services for document processing and retrieval."""

from .base import BaseEmbeddingService
from .factory import create_embedding_service, resolve_embedding_settings
from .google_service import GoogleEmbeddingService
from .openai_service import EmbeddingAPIKeyNotConfiguredError, OpenAIEmbeddingService

__all__ = [
    "BaseEmbeddingService",
    "create_embedding_service",
    "EmbeddingAPIKeyNotConfiguredError",
    "GoogleEmbeddingService",
    "OpenAIEmbeddingService",
    "resolve_embedding_settings",
]
