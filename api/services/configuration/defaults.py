from __future__ import annotations

"""Utilities for building default service configurations for a new user.

SPX Voice is LiveKit + Gemini realtime first. The traditional STT/LLM/TTS stack
is still available as a secondary mode, but a fresh OSS/Coolify install should
be usable when a Gemini key is provided in the deployment environment.
"""

import os

from api.schemas.user_configuration import UserConfiguration
from api.services.configuration.registry import (
    DeepgramSTTConfiguration,
    ElevenlabsTTSConfiguration,
    GoogleEmbeddingsConfiguration,
    GoogleLLMService,
    GoogleRealtimeLLMConfiguration,
    OpenAIEmbeddingsConfiguration,
    OpenAILLMService,
    ServiceProviders,
)

DEFAULT_REALTIME_MODEL = os.getenv(
    "DEFAULT_REALTIME_MODEL", "gemini-3.1-flash-live-preview"
)
DEFAULT_REALTIME_VOICE = os.getenv("DEFAULT_REALTIME_VOICE", "Kore")
DEFAULT_REALTIME_LANGUAGE = os.getenv("DEFAULT_REALTIME_LANGUAGE", "en")
DEFAULT_GOOGLE_LLM_MODEL = os.getenv("DEFAULT_GOOGLE_LLM_MODEL", "gemini-2.5-flash")
DEFAULT_GOOGLE_EMBEDDING_MODEL = os.getenv(
    "DEFAULT_GOOGLE_EMBEDDING_MODEL", "gemini-embedding-001"
)

GOOGLE_API_KEY_ENV_NAMES = (
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_AI_API_KEY",
)


# Mapping of service to (provider enum, configuration class). The UI reads this
# to decide which provider to preselect before the user has saved a config.
_DEFAULTS = {
    "llm": (ServiceProviders.GOOGLE, GoogleLLMService),
    "tts": (ServiceProviders.ELEVENLABS, ElevenlabsTTSConfiguration),
    "stt": (ServiceProviders.DEEPGRAM, DeepgramSTTConfiguration),
    "embeddings": (ServiceProviders.GOOGLE, GoogleEmbeddingsConfiguration),
    "realtime": (ServiceProviders.GOOGLE_REALTIME, GoogleRealtimeLLMConfiguration),
}

# Public mapping of service name -> default provider
DEFAULT_SERVICE_PROVIDERS = {
    field: provider for field, (provider, _) in _DEFAULTS.items()
}

DEFAULT_IS_REALTIME = True


def _first_env_value(names: tuple[str, ...]) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value and value.strip():
            return value.strip()
    return None


def build_env_default_user_configuration() -> UserConfiguration | None:
    """Build a first-run config from deployment env vars, if available.

    Gemini realtime is preferred. If no Gemini key exists, fall back to a
    complete traditional OpenAI + Deepgram + ElevenLabs setup when all three
    keys are present.
    """

    google_key = _first_env_value(GOOGLE_API_KEY_ENV_NAMES)
    if google_key:
        return UserConfiguration(
            is_realtime=True,
            realtime=GoogleRealtimeLLMConfiguration(
                provider=ServiceProviders.GOOGLE_REALTIME,
                api_key=[google_key],
                model=DEFAULT_REALTIME_MODEL,
                voice=DEFAULT_REALTIME_VOICE,
                language=DEFAULT_REALTIME_LANGUAGE,
            ),
            llm=GoogleLLMService(
                provider=ServiceProviders.GOOGLE,
                api_key=[google_key],
                model=DEFAULT_GOOGLE_LLM_MODEL,
            ),
            embeddings=GoogleEmbeddingsConfiguration(
                provider=ServiceProviders.GOOGLE,
                api_key=[google_key],
                model=DEFAULT_GOOGLE_EMBEDDING_MODEL,
            ),
        )

    openai_key = _first_env_value(("OPENAI_API_KEY",))
    deepgram_key = _first_env_value(("DEEPGRAM_API_KEY",))
    elevenlabs_key = _first_env_value(("ELEVENLABS_API_KEY", "ELEVEN_API_KEY"))
    if openai_key and deepgram_key and elevenlabs_key:
        return UserConfiguration(
            is_realtime=False,
            llm=OpenAILLMService(
                provider=ServiceProviders.OPENAI,
                api_key=[openai_key],
                model="gpt-4.1",
            ),
            stt=DeepgramSTTConfiguration(
                provider=ServiceProviders.DEEPGRAM,
                api_key=[deepgram_key],
                model="nova-3-general",
            ),
            tts=ElevenlabsTTSConfiguration(
                provider=ServiceProviders.ELEVENLABS,
                api_key=[elevenlabs_key],
                model="eleven_flash_v2_5",
                voice="21m00Tcm4TlvDq8ikWAM",
            ),
            embeddings=OpenAIEmbeddingsConfiguration(
                provider=ServiceProviders.OPENAI,
                api_key=[openai_key],
                model="text-embedding-3-small",
            ),
        )

    return None


__all__ = [
    "DEFAULT_IS_REALTIME",
    "DEFAULT_SERVICE_PROVIDERS",
    "build_env_default_user_configuration",
]
