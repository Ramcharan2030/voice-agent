from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api.services.pricing import workflow_run_cost as workflow_run_cost_mod
from api.services.pricing.workflow_run_cost import (
    _fetch_telephony_cost,
    apply_usage_delta_to_organization,
    build_workflow_run_cost_info,
    calculate_workflow_run_cost,
)

CHARGE_FIELD = "charge" + "_usd"


def _make_workflow_run():
    return SimpleNamespace(
        id=123,
        workflow_id=456,
        mode="textchat",
        call_type="outbound",
        created_at=datetime.now(UTC),
        usage_info={
            "llm": {},
            "tts": {},
            "stt": {},
            "call_duration_seconds": 7,
        },
        cost_info={},
        gathered_context={},
        initial_context={},
        workflow=SimpleNamespace(
            organization_id=42,
            user=SimpleNamespace(selected_organization_id=42),
        ),
    )


@pytest.mark.asyncio
async def test_build_workflow_run_cost_info_does_not_update_org_usage(monkeypatch):
    workflow_run = _make_workflow_run()
    get_org = AsyncMock(return_value=SimpleNamespace(id=42))
    update_usage = AsyncMock()

    monkeypatch.setattr(
        workflow_run_cost_mod.db_client, "get_organization_by_id", get_org
    )
    monkeypatch.setattr(
        workflow_run_cost_mod.db_client, "update_usage_after_run", update_usage
    )

    cost_info = await build_workflow_run_cost_info(workflow_run)

    assert cost_info is not None
    assert cost_info["call_duration_seconds"] == 7
    assert "cost_breakdown" in cost_info
    assert "actual_cost" in cost_info
    assert "dograh_token_usage" in cost_info
    assert CHARGE_FIELD not in cost_info
    update_usage.assert_not_called()


@pytest.mark.asyncio
async def test_build_workflow_run_cost_info_uses_realtime_duration_estimate(
    monkeypatch,
):
    workflow_run = _make_workflow_run()
    workflow_run.usage_info = {
        "llm": {},
        "tts": {},
        "stt": {},
        "call_duration_seconds": 60,
    }
    workflow_run.initial_context = {
        "runtime_configuration": {
            "realtime_provider": "google_realtime",
            "realtime_model": "gemini-3.1-flash-live-preview",
        }
    }
    monkeypatch.setattr(
        workflow_run_cost_mod.db_client,
        "get_organization_by_id",
        AsyncMock(return_value=SimpleNamespace(id=42)),
    )

    cost_info = await build_workflow_run_cost_info(workflow_run)

    assert cost_info is not None
    assert cost_info["cost_breakdown"]["realtime_duration_estimate"] == pytest.approx(
        0.023
    )
    assert cost_info["total_cost_usd"] == pytest.approx(0.023)
    assert cost_info["dograh_token_usage"] == pytest.approx(2.3)
    assert cost_info["actual_cost"]["ai_total_usd"] == pytest.approx(0.023)


@pytest.mark.asyncio
async def test_calculate_workflow_run_cost_keeps_org_usage_side_effect_in_wrapper(
    monkeypatch,
):
    workflow_run = _make_workflow_run()
    get_org = AsyncMock(return_value=SimpleNamespace(id=42))
    update_run = AsyncMock()
    update_usage = AsyncMock()

    monkeypatch.setattr(
        workflow_run_cost_mod.db_client,
        "get_workflow_run_by_id",
        AsyncMock(return_value=workflow_run),
    )
    monkeypatch.setattr(
        workflow_run_cost_mod.db_client, "get_organization_by_id", get_org
    )
    monkeypatch.setattr(
        workflow_run_cost_mod.db_client, "update_workflow_run", update_run
    )
    monkeypatch.setattr(
        workflow_run_cost_mod.db_client, "update_usage_after_run", update_usage
    )

    await calculate_workflow_run_cost(workflow_run.id)

    update_run.assert_awaited_once()
    saved_kwargs = update_run.await_args.kwargs
    assert saved_kwargs["run_id"] == workflow_run.id
    assert "cost_breakdown" in saved_kwargs["cost_info"]
    update_usage.assert_awaited_once()


@pytest.mark.asyncio
async def test_apply_usage_delta_to_organization_uses_incremental_costs(
    monkeypatch,
):
    workflow_run = _make_workflow_run()
    workflow_run.cost_info = {"call_id": "preserve-me"}

    usage_delta_one = {
        "llm": {
            "OpenAILLMService#0|||gpt-4.1-mini": {
                "prompt_tokens": 1_000,
                "completion_tokens": 100,
                "total_tokens": 1_100,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            }
        },
        "tts": {},
        "stt": {},
        "call_duration_seconds": 3,
    }
    usage_delta_two = {
        "llm": {
            "OpenAILLMService#0|||gpt-4.1-mini": {
                "prompt_tokens": 2_000,
                "completion_tokens": 50,
                "total_tokens": 2_050,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            }
        },
        "tts": {},
        "stt": {},
        "call_duration_seconds": 4,
    }
    merged_usage = {
        "llm": {
            "OpenAILLMService#0|||gpt-4.1-mini": {
                "prompt_tokens": 3_000,
                "completion_tokens": 150,
                "total_tokens": 3_150,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            }
        },
        "tts": {},
        "stt": {},
        "call_duration_seconds": 7,
    }

    get_org = AsyncMock(return_value=SimpleNamespace(id=42))
    update_usage = AsyncMock()

    monkeypatch.setattr(
        workflow_run_cost_mod.db_client, "get_organization_by_id", get_org
    )
    monkeypatch.setattr(
        workflow_run_cost_mod.db_client, "update_usage_after_run", update_usage
    )

    first_delta = await apply_usage_delta_to_organization(workflow_run, usage_delta_one)
    second_delta = await apply_usage_delta_to_organization(
        workflow_run, usage_delta_two
    )
    total_workflow_run = SimpleNamespace(**workflow_run.__dict__)
    total_workflow_run.usage_info = merged_usage
    total_cost = await build_workflow_run_cost_info(total_workflow_run)

    assert first_delta is not None
    assert second_delta is not None
    assert total_cost is not None
    assert update_usage.await_count == 2
    assert update_usage.await_args_list[0].args == (
        42,
        first_delta["dograh_token_usage"],
        3.0,
    )
    assert update_usage.await_args_list[1].args == (
        42,
        second_delta["dograh_token_usage"],
        4.0,
    )
    assert (
        first_delta["dograh_token_usage"] + second_delta["dograh_token_usage"]
    ) == pytest.approx(total_cost["dograh_token_usage"])
    assert CHARGE_FIELD not in first_delta
    assert CHARGE_FIELD not in second_delta
    assert CHARGE_FIELD not in total_cost


@pytest.mark.asyncio
async def test_fetch_telephony_cost_supports_vobiz_gathered_call_id(monkeypatch):
    workflow_run = SimpleNamespace(
        id=123,
        workflow_id=456,
        mode="vobiz",
        cost_info={},
        gathered_context={"call_id": "vobiz-call-1"},
        initial_context={},
    )
    provider = SimpleNamespace(
        get_call_cost=AsyncMock(
            return_value={
                "cost_usd": 0.04,
                "duration": 120,
                "status": "completed",
                "price_unit": "USD",
                "call_rate": "0.02",
            }
        )
    )

    monkeypatch.setattr(
        workflow_run_cost_mod.db_client,
        "get_workflow_by_id",
        AsyncMock(return_value=SimpleNamespace(organization_id=42)),
    )
    monkeypatch.setattr(
        workflow_run_cost_mod,
        "_get_telephony_provider_for_run",
        AsyncMock(return_value=provider),
    )

    result = await _fetch_telephony_cost(workflow_run)

    assert result is not None
    assert result["cost_usd"] == 0.04
    assert result["cost_inr"] == 0.0
    assert result["currency"] == "USD"
    assert result["provider_name"] == "vobiz"
    assert result["call_id"] == "vobiz-call-1"
    assert result["duration"] == 120
    assert result["status"] == "completed"
    assert result["price_unit"] == "USD"
    assert result["call_rate"] == "0.02"
    provider.get_call_cost.assert_awaited_once_with("vobiz-call-1")
