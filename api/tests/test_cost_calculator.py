from api.services.pricing.cost_calculator import cost_calculator


def test_cost_calculator():
    """Test function to verify cost calculation works"""
    sample_usage = {
        "llm": {
            "OpenAILLMService#0|||gpt-4.1-mini": {
                "prompt_tokens": 45380,
                "completion_tokens": 496,
                "total_tokens": 45876,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            }
        },
        "tts": {"ElevenLabsTTSService#0|||eleven_flash_v2_5": 2399},
        "stt": {"DeepgramSTTService#0|||nova-3-general": 177.21536946296692},
        "call_duration_seconds": 179,
    }

    result = cost_calculator.calculate_total_cost(sample_usage)
    assert result["llm_cost"] == 45380 * 0.40 / 1_000_000 + 496 * 1.60 / 1_000_000
    assert result["tts_cost"] == 2399 * 0.0256 / 1_000
    assert result["stt_cost"] == 177.21536946296692 / 60 * 0.0077
    assert (
        abs(
            result["total"]
            - (result["llm_cost"] + result["tts_cost"] + result["stt_cost"])
        )
        < 1e-10
    )


def test_actual_cost_itemizes_groq_and_realtime_duration_estimate():
    usage = {
        "llm": {
            "GroqLLMService#0|||llama-3.1-8b-instant": {
                "prompt_tokens": 1_000,
                "completion_tokens": 500,
                "total_tokens": 1_500,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            }
        },
        "tts": {},
        "stt": {},
        "call_duration_seconds": 60,
    }

    result = cost_calculator.calculate_actual_cost(
        usage,
        runtime_configuration={
            "realtime_provider": "google_realtime",
            "realtime_model": "gemini-3.1-flash-live-preview",
        },
    )

    groq_item = next(
        item
        for item in result["components"]
        if item["provider"] == "groq" and item["model"] == "llama-3.1-8b-instant"
    )
    realtime_item = next(
        item
        for item in result["components"]
        if item["provider"] == "google_realtime"
        and item["model"] == "gemini-3.1-flash-live-preview"
    )

    assert groq_item["cost_usd"] == 1_000 * 0.05 / 1_000_000 + 500 * 0.08 / 1_000_000
    assert realtime_item["cost_usd"] == 0.005 + 0.018
    assert realtime_item["cost_inr"] > realtime_item["cost_usd"]
    assert realtime_item["estimated"] is True
    assert result["total_usd"] == groq_item["cost_usd"] + realtime_item["cost_usd"]
    assert result["currency"] == "INR"
    assert result["total_inr"] > result["total_usd"]


def test_actual_cost_infers_gemini_realtime_from_processor():
    usage = {
        "llm": {
            "GeminiLiveLLMService#0|||gemini-3.1-flash-live-preview": {
                "prompt_tokens": 2_000,
                "completion_tokens": 1_000,
                "total_tokens": 3_000,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            }
        },
        "tts": {},
        "stt": {},
    }

    result = cost_calculator.calculate_actual_cost(usage)
    item = result["components"][0]

    assert item["service"] == "realtime"
    assert item["provider"] == "google_realtime"
    assert item["cost_usd"] == 2_000 * 0.75 / 1_000_000 + 1_000 * 4.50 / 1_000_000
    assert item["cost_inr"] > item["cost_usd"]
    assert item["estimated"] is True
