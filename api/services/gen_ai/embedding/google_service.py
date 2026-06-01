"""Google Gemini embedding service."""

from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types
from loguru import logger

from api.db.db_client import DBClient

from .base import BaseEmbeddingService

DEFAULT_MODEL_ID = "gemini-embedding-001"
EMBEDDING_DIMENSION = 1536


class GoogleEmbeddingService(BaseEmbeddingService):
    """Embedding service using Gemini embeddings with 1536-dim output."""

    def __init__(
        self,
        db_client: DBClient,
        api_key: Optional[str] = None,
        model_id: str = DEFAULT_MODEL_ID,
    ):
        self.db = db_client
        self.model_id = model_id
        self._api_key_configured = bool(api_key)
        self.client = genai.Client(api_key=api_key) if api_key else None
        if self._api_key_configured:
            logger.info(f"Google embedding service initialized with model: {model_id}")
        else:
            logger.warning("Google embedding service initialized without API key.")

    def get_model_id(self) -> str:
        return self.model_id

    def get_embedding_dimension(self) -> int:
        return EMBEDDING_DIMENSION

    def _ensure_api_key_configured(self):
        if not self._api_key_configured or self.client is None:
            raise ValueError(
                "Google embeddings API key not configured. Set Google embeddings "
                "or configure Google realtime so the existing key can be reused."
            )

    async def _embed(self, texts: List[str], task_type: str) -> List[List[float]]:
        if not texts:
            return []

        self._ensure_api_key_configured()
        assert self.client is not None
        response = await self.client.aio.models.embed_content(
            model=self.model_id,
            contents=texts,
            config=types.EmbedContentConfig(
                taskType=task_type,
                outputDimensionality=EMBEDDING_DIMENSION,
            ),
        )
        embeddings = response.embeddings or []
        vectors = [embedding.values or [] for embedding in embeddings]
        for vector in vectors:
            if len(vector) != EMBEDDING_DIMENSION:
                raise ValueError(
                    f"Google embedding model {self.model_id} returned "
                    f"{len(vector)} dimensions; expected {EMBEDDING_DIMENSION}"
                )
        return vectors

    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        return await self._embed(texts, "RETRIEVAL_DOCUMENT")

    async def embed_query(self, query: str) -> List[float]:
        embeddings = await self._embed([query], "RETRIEVAL_QUERY")
        return embeddings[0]

    async def search_similar_chunks(
        self,
        query: str,
        organization_id: int,
        limit: int = 5,
        document_uuids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        query_embedding = await self.embed_query(query)
        return await self.db.search_similar_chunks(
            query_embedding=query_embedding,
            organization_id=organization_id,
            limit=limit,
            document_uuids=document_uuids,
            embedding_model=self.model_id,
        )
