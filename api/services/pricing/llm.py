"""
LLM pricing models for different providers.

Prices are per 1000 tokens for most models, with some newer models priced per million tokens.
"""

from decimal import Decimal
from typing import Dict

from api.services.configuration.registry import ServiceProviders

from .models import TokenPricingModel

# LLM pricing registry
LLM_PRICING: Dict[str, Dict[str, TokenPricingModel]] = {
    ServiceProviders.OPENAI: {
        "gpt-3.5-turbo": TokenPricingModel(
            prompt_token_price=Decimal("0.0015") / 1000,  # $0.0015 per 1K tokens
            completion_token_price=Decimal("0.002") / 1000,  # $0.002 per 1K tokens
        ),
        "gpt-4": TokenPricingModel(
            prompt_token_price=Decimal("0.03") / 1000,  # $0.03 per 1K tokens
            completion_token_price=Decimal("0.06") / 1000,  # $0.06 per 1K tokens
        ),
        "gpt-4.1": TokenPricingModel(
            prompt_token_price=Decimal("2.00") / 1000000,  # $2.00 per 1M tokens
            completion_token_price=Decimal("8.00") / 1000000,  # $8.00 per 1M tokens
        ),
        "gpt-4.1-mini": TokenPricingModel(
            prompt_token_price=Decimal("0.40") / 1000000,  # $0.40 per 1M tokens
            completion_token_price=Decimal("1.60") / 1000000,  # $1.60 per 1M tokens
        ),
        "gpt-4.1-nano": TokenPricingModel(
            prompt_token_price=Decimal("0.10") / 1000000,  # $0.10 per 1M tokens
            completion_token_price=Decimal("0.40") / 1000000,  # $0.40 per 1M tokens
        ),
        "gpt-4.5-preview": TokenPricingModel(
            prompt_token_price=Decimal("75.00") / 1000000,  # $75.00 per 1M tokens
            completion_token_price=Decimal("150.00") / 1000000,  # $150.00 per 1M tokens
        ),
        "gpt-4o": TokenPricingModel(
            prompt_token_price=Decimal("2.50") / 1000000,  # $2.50 per 1M tokens - FIXED
            completion_token_price=Decimal("10.00")
            / 1000000,  # $10.00 per 1M tokens - FIXED
        ),
        "gpt-4o-audio-preview": TokenPricingModel(
            prompt_token_price=Decimal("2.50") / 1000000,  # $2.50 per 1M tokens
            completion_token_price=Decimal("10.00") / 1000000,  # $10.00 per 1M tokens
        ),
        "gpt-4o-realtime-preview": TokenPricingModel(
            prompt_token_price=Decimal("5.00") / 1000000,  # $5.00 per 1M tokens
            completion_token_price=Decimal("20.00") / 1000000,  # $20.00 per 1M tokens
        ),
        "gpt-4o-mini": TokenPricingModel(
            prompt_token_price=Decimal("0.15") / 1000000,  # $0.15 per 1M tokens
            completion_token_price=Decimal("0.60") / 1000000,  # $0.60 per 1M tokens
        ),
        "gpt-4o-mini-audio-preview": TokenPricingModel(
            prompt_token_price=Decimal("0.15") / 1000000,  # $0.15 per 1M tokens
            completion_token_price=Decimal("0.60") / 1000000,  # $0.60 per 1M tokens
        ),
        "gpt-4o-mini-realtime-preview": TokenPricingModel(
            prompt_token_price=Decimal("0.60") / 1000000,  # $0.60 per 1M tokens
            completion_token_price=Decimal("2.40") / 1000000,  # $2.40 per 1M tokens
        ),
        "gpt-4o-search-preview": TokenPricingModel(
            prompt_token_price=Decimal("2.50") / 1000000,  # $2.50 per 1M tokens
            completion_token_price=Decimal("10.00") / 1000000,  # $10.00 per 1M tokens
        ),
        "gpt-4o-mini-search-preview": TokenPricingModel(
            prompt_token_price=Decimal("0.15") / 1000000,  # $0.15 per 1M tokens
            completion_token_price=Decimal("0.60") / 1000000,  # $0.60 per 1M tokens
        ),
        "o1": TokenPricingModel(
            prompt_token_price=Decimal("15.00") / 1000000,  # $15.00 per 1M tokens
            completion_token_price=Decimal("60.00") / 1000000,  # $60.00 per 1M tokens
        ),
        "o1-pro": TokenPricingModel(
            prompt_token_price=Decimal("150.00") / 1000000,  # $150.00 per 1M tokens
            completion_token_price=Decimal("600.00") / 1000000,  # $600.00 per 1M tokens
        ),
        "o1-mini": TokenPricingModel(
            prompt_token_price=Decimal("1.10") / 1000000,  # $1.10 per 1M tokens
            completion_token_price=Decimal("4.40") / 1000000,  # $4.40 per 1M tokens
        ),
        "o3": TokenPricingModel(
            prompt_token_price=Decimal("10.00") / 1000000,  # $10.00 per 1M tokens
            completion_token_price=Decimal("40.00") / 1000000,  # $40.00 per 1M tokens
        ),
        "o3-mini": TokenPricingModel(
            prompt_token_price=Decimal("1.10") / 1000000,  # $1.10 per 1M tokens
            completion_token_price=Decimal("4.40") / 1000000,  # $4.40 per 1M tokens
        ),
        "o4-mini": TokenPricingModel(
            prompt_token_price=Decimal("1.10") / 1000000,  # $1.10 per 1M tokens
            completion_token_price=Decimal("4.40") / 1000000,  # $4.40 per 1M tokens
        ),
        "computer-use-preview": TokenPricingModel(
            prompt_token_price=Decimal("3.00") / 1000000,  # $3.00 per 1M tokens
            completion_token_price=Decimal("12.00") / 1000000,  # $12.00 per 1M tokens
        ),
        "gpt-image-1": TokenPricingModel(
            prompt_token_price=Decimal("5.00") / 1000000,  # $5.00 per 1M tokens
            completion_token_price=Decimal("0") / 1000000,  # No output pricing shown
        ),
        "codex-mini-latest": TokenPricingModel(
            prompt_token_price=Decimal("1.50") / 1000000,  # $1.50 per 1M tokens
            completion_token_price=Decimal("6.00") / 1000000,  # $6.00 per 1M tokens
        ),
        # Transcription models
        "gpt-4o-transcribe": TokenPricingModel(
            prompt_token_price=Decimal("2.50") / 1000000,  # $2.50 per 1M tokens
            completion_token_price=Decimal("10.00") / 1000000,  # $10.00 per 1M tokens
        ),
        "gpt-4o-mini-transcribe": TokenPricingModel(
            prompt_token_price=Decimal("1.25") / 1000000,  # $1.25 per 1M tokens
            completion_token_price=Decimal("5.00") / 1000000,  # $5.00 per 1M tokens
        ),
        # TTS models with token-based pricing
        "gpt-4o-mini-tts": TokenPricingModel(
            prompt_token_price=Decimal("0.60") / 1000000,  # $0.60 per 1M tokens
            completion_token_price=Decimal("0")
            / 1000000,  # No completion tokens for TTS
        ),
    },
    ServiceProviders.GROQ: {
        "llama-3.3-70b-versatile": TokenPricingModel(
            prompt_token_price=Decimal("0.59") / 1000000,
            completion_token_price=Decimal("0.79") / 1000000,
        ),
        "llama-3.1-8b-instant": TokenPricingModel(
            prompt_token_price=Decimal("0.05") / 1000000,
            completion_token_price=Decimal("0.08") / 1000000,
        ),
        "meta-llama/llama-4-scout-17b-16e-instruct": TokenPricingModel(
            prompt_token_price=Decimal("0.11") / 1000000,
            completion_token_price=Decimal("0.34") / 1000000,
        ),
        "qwen/qwen3-32b": TokenPricingModel(
            prompt_token_price=Decimal("0.29") / 1000000,
            completion_token_price=Decimal("0.59") / 1000000,
        ),
        "openai/gpt-oss-120b": TokenPricingModel(
            prompt_token_price=Decimal("0.15") / 1000000,
            completion_token_price=Decimal("0.60") / 1000000,
        ),
        "openai/gpt-oss-20b": TokenPricingModel(
            prompt_token_price=Decimal("0.075") / 1000000,
            completion_token_price=Decimal("0.30") / 1000000,
        ),
    },
    ServiceProviders.GOOGLE: {
        "gemini-2.5-flash": TokenPricingModel(
            prompt_token_price=Decimal("0.30") / 1000000,
            completion_token_price=Decimal("2.50") / 1000000,
        ),
        "gemini-2.5-flash-lite": TokenPricingModel(
            prompt_token_price=Decimal("0.10") / 1000000,
            completion_token_price=Decimal("0.40") / 1000000,
        ),
        "gemini-2.0-flash": TokenPricingModel(
            prompt_token_price=Decimal("0.10") / 1000000,
            completion_token_price=Decimal("0.40") / 1000000,
        ),
        "gemini-2.0-flash-lite": TokenPricingModel(
            prompt_token_price=Decimal("0.075") / 1000000,
            completion_token_price=Decimal("0.30") / 1000000,
        ),
    },
    ServiceProviders.GOOGLE_REALTIME: {
        "gemini-3.1-flash-live-preview": TokenPricingModel(
            prompt_token_price=Decimal("0.75") / 1000000,
            completion_token_price=Decimal("4.50") / 1000000,
        ),
        "gemini-2.5-flash-native-audio-preview-12-2025": TokenPricingModel(
            prompt_token_price=Decimal("0.50") / 1000000,
            completion_token_price=Decimal("2.00") / 1000000,
        ),
    },
    ServiceProviders.GOOGLE_VERTEX_REALTIME: {
        "google/gemini-live-2.5-flash-native-audio": TokenPricingModel(
            prompt_token_price=Decimal("0.50") / 1000000,
            completion_token_price=Decimal("2.00") / 1000000,
        ),
        "gemini-2.5-flash-native-audio-preview-12-2025": TokenPricingModel(
            prompt_token_price=Decimal("0.50") / 1000000,
            completion_token_price=Decimal("2.00") / 1000000,
        ),
    },
    ServiceProviders.AZURE: {
        "gpt-4.1-mini": TokenPricingModel(
            prompt_token_price=Decimal("0.44") / 1000000,  # $0.40 per 1M tokens
            completion_token_price=Decimal("8.80")
            / 1000000,  # $1.60 per 1M tokens if using data zone
        )
    },
}
