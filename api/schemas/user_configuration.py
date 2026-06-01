from datetime import datetime

from pydantic import BaseModel, model_validator

from api.services.configuration.registry import (
    EmbeddingsConfig,
    LLMConfig,
    RealtimeConfig,
    STTConfig,
    TTSConfig,
)


class UserConfiguration(BaseModel):
    llm: LLMConfig | None = None
    stt: STTConfig | None = None
    tts: TTSConfig | None = None
    embeddings: EmbeddingsConfig | None = None
    realtime: RealtimeConfig | None = None
    is_realtime: bool = False
    test_phone_number: str | None = None
    timezone: str | None = None
    last_validated_at: datetime | None = None

    @model_validator(mode="before")
    @classmethod
    def strip_inactive_incomplete_services(cls, data):
        """Skip validation for inactive pipeline sections that have no API key."""
        if not isinstance(data, dict):
            return data

        def has_api_key(service: object) -> bool:
            if not isinstance(service, dict):
                return False
            api_key = service.get("api_key")
            if isinstance(api_key, list):
                return any(bool(str(key).strip()) for key in api_key)
            return bool(str(api_key).strip()) if api_key is not None else False

        if data.get("is_realtime", False):
            for service_name in ("llm", "stt", "tts"):
                service = data.get(service_name)
                if isinstance(service, dict) and not has_api_key(service):
                    data.pop(service_name, None)
        else:
            realtime = data.get("realtime")
            if isinstance(realtime, dict) and not has_api_key(realtime):
                data.pop("realtime", None)
        return data
