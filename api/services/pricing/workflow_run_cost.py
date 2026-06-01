from decimal import Decimal

from loguru import logger

from api.db import db_client
from api.enums import WorkflowRunMode
from api.services.pricing.cost_calculator import cost_calculator, usd_to_inr


async def _get_telephony_provider_for_run(workflow_run, organization_id: int):
    from api.services.telephony.factory import get_telephony_provider_for_run

    return await get_telephony_provider_for_run(workflow_run, organization_id)


async def _fetch_telephony_cost(workflow_run) -> dict | None:
    """Fetch telephony call cost in the provider's native CDR currency."""
    if workflow_run.mode not in [
        WorkflowRunMode.TWILIO.value,
        WorkflowRunMode.VONAGE.value,
        WorkflowRunMode.VOBIZ.value,
    ]:
        return None

    cost_info = workflow_run.cost_info or {}
    gathered_context = workflow_run.gathered_context or {}
    initial_context = workflow_run.initial_context or {}
    call_id = (
        cost_info.get("call_id")
        or gathered_context.get("call_id")
        or gathered_context.get("CallUUID")
        or initial_context.get("call_id")
    )
    if not call_id:
        logger.warning("call_id not found in cost_info")
        return None

    provider_name = workflow_run.mode.lower() if workflow_run.mode else ""

    workflow = await db_client.get_workflow_by_id(workflow_run.workflow_id)
    if not workflow:
        logger.warning("Workflow not found for workflow run")
        raise Exception("Workflow not found")

    provider = await _get_telephony_provider_for_run(
        workflow_run, workflow.organization_id
    )
    call_cost_info = await provider.get_call_cost(call_id)

    if call_cost_info.get("status") == "error":
        logger.error(
            f"Failed to fetch {provider_name} call cost: {call_cost_info.get('error')}"
        )
        return None

    currency = str(
        call_cost_info.get("currency") or call_cost_info.get("price_unit") or "USD"
    ).upper()
    cost_usd = call_cost_info.get("cost_usd")
    cost_inr = call_cost_info.get("cost_inr")
    if cost_inr is None and currency == "INR":
        cost_inr = call_cost_info.get("cost")
    if cost_usd is None and currency == "USD":
        cost_usd = call_cost_info.get("cost")
    logged_cost = cost_inr if currency == "INR" else cost_usd
    logger.info(
        f"{provider_name.title()} call cost: {currency} "
        f"{float(logged_cost or 0):.6f} "
        f"for call {call_id}"
    )
    return {
        "cost_usd": float(cost_usd or 0),
        "cost_inr": float(cost_inr or 0),
        "currency": currency,
        "provider_name": provider_name,
        "call_id": call_id,
        "duration": call_cost_info.get("duration"),
        "status": call_cost_info.get("status"),
        "price_unit": currency,
        "call_rate": call_cost_info.get("call_rate"),
        "rate_inr_per_minute": call_cost_info.get("rate_inr_per_minute"),
        "rate_usd_per_minute": call_cost_info.get("rate_usd_per_minute"),
        "billing_increment_seconds": call_cost_info.get("billing_increment_seconds"),
        "minimum_duration_seconds": call_cost_info.get("minimum_duration_seconds"),
        "estimated": bool(call_cost_info.get("estimated")),
        "source": call_cost_info.get("source") or "provider_cdr",
        "source_url": call_cost_info.get("source_url"),
    }


def _runtime_configuration(workflow_run) -> dict | None:
    initial_context = getattr(workflow_run, "initial_context", None) or {}
    runtime_configuration = initial_context.get("runtime_configuration")
    return runtime_configuration if isinstance(runtime_configuration, dict) else None


def _add_telephony_component(actual_cost: dict, telephony_cost: dict) -> None:
    cost_usd = Decimal(str(telephony_cost.get("cost_usd") or 0))
    cost_inr = Decimal(str(telephony_cost.get("cost_inr") or 0))
    currency = str(telephony_cost.get("currency") or "USD").upper()
    if currency == "USD" and cost_inr == 0:
        cost_inr = usd_to_inr(cost_usd)
    provider_name = telephony_cost.get("provider_name") or "telephony"
    component = {
        "service": "telephony",
        "provider": provider_name,
        "model": "cdr",
        "label": f"{provider_name.title()} CDR",
        "currency": currency,
        "cost_usd": float(cost_usd),
        "cost_inr": float(cost_inr),
        "priced": True,
        "estimated": bool(telephony_cost.get("estimated")),
        "usage": {
            "call_id": telephony_cost.get("call_id"),
            "duration_seconds": telephony_cost.get("duration"),
            "status": telephony_cost.get("status"),
        },
        "pricing": {
            "currency": currency,
            "call_rate": telephony_cost.get("call_rate"),
            "rate_inr_per_minute": telephony_cost.get("rate_inr_per_minute"),
            "rate_usd_per_minute": telephony_cost.get("rate_usd_per_minute"),
            "billing_increment_seconds": telephony_cost.get(
                "billing_increment_seconds"
            ),
            "minimum_duration_seconds": telephony_cost.get("minimum_duration_seconds"),
        },
        "source_url": telephony_cost.get("source_url"),
        "note": (
            "Authoritative telephony CDR cost returned by the provider."
            if not telephony_cost.get("estimated")
            else "Estimated from provider account pricing because a CDR cost was not available."
        ),
    }
    actual_cost.setdefault("components", []).append(component)
    actual_cost["telephony_total_usd"] = float(
        Decimal(str(actual_cost.get("telephony_total_usd") or 0)) + cost_usd
    )
    actual_cost["total_usd"] = float(
        Decimal(str(actual_cost.get("total_usd") or 0)) + cost_usd
    )
    actual_cost["telephony_total_inr"] = float(
        Decimal(str(actual_cost.get("telephony_total_inr") or 0)) + cost_inr
    )
    actual_cost["total_inr"] = float(
        Decimal(str(actual_cost.get("total_inr") or 0)) + cost_inr
    )


async def _update_organization_usage(
    org, dograh_tokens: float, duration_seconds: float
) -> None:
    """Update organization usage after a workflow run."""
    org_id = org.id
    await db_client.update_usage_after_run(org_id, dograh_tokens, duration_seconds)
    logger.info(
        f"Updated organization usage with {dograh_tokens} Dograh Tokens and {duration_seconds}s duration for org {org_id}"
    )


async def _get_pricing_organization(workflow_run):
    workflow = getattr(workflow_run, "workflow", None)
    organization_id = getattr(workflow, "organization_id", None)
    if organization_id is None and workflow and workflow.user:
        organization_id = workflow.user.selected_organization_id
    if organization_id is None:
        return None
    return await db_client.get_organization_by_id(organization_id)


async def _build_usage_cost_snapshot(
    usage_info: dict | None,
    *,
    workflow_run=None,
    include_telephony_cost: bool = False,
    organization=None,
    calculated_at: str | None = None,
) -> dict | None:
    if not usage_info:
        logger.warning("No usage info available for workflow run")
        return None

    cost_breakdown = cost_calculator.calculate_total_cost(usage_info)
    actual_cost = cost_calculator.calculate_actual_cost(
        usage_info,
        runtime_configuration=(
            _runtime_configuration(workflow_run) if workflow_run is not None else None
        ),
        calculated_at=calculated_at
        or (workflow_run.created_at.isoformat() if workflow_run is not None else None),
    )
    ai_breakdown_usd = (
        Decimal(str(cost_breakdown.get("llm_cost") or 0))
        + Decimal(str(cost_breakdown.get("tts_cost") or 0))
        + Decimal(str(cost_breakdown.get("stt_cost") or 0))
    )
    actual_ai_total_usd = Decimal(str(actual_cost.get("ai_total_usd") or 0))
    if actual_ai_total_usd > ai_breakdown_usd:
        realtime_estimate_usd = actual_ai_total_usd - ai_breakdown_usd
        cost_breakdown["realtime_duration_estimate"] = float(realtime_estimate_usd)
        cost_breakdown["total"] = float(
            Decimal(str(cost_breakdown["total"])) + realtime_estimate_usd
        )

    if include_telephony_cost and workflow_run is not None:
        try:
            telephony_cost = await _fetch_telephony_cost(workflow_run)
            if telephony_cost:
                telephony_cost_usd = float(telephony_cost.get("cost_usd") or 0)
                telephony_cost_inr = float(telephony_cost.get("cost_inr") or 0)
                provider_name = telephony_cost["provider_name"]
                if telephony_cost_usd:
                    cost_breakdown["telephony_call"] = telephony_cost_usd
                    cost_breakdown[f"{provider_name}_call"] = telephony_cost_usd
                    cost_breakdown["total"] = (
                        float(cost_breakdown["total"]) + telephony_cost_usd
                    )
                if telephony_cost_inr:
                    cost_breakdown["telephony_call_inr"] = telephony_cost_inr
                    cost_breakdown[f"{provider_name}_call_inr"] = telephony_cost_inr
                _add_telephony_component(actual_cost, telephony_cost)
        except Exception as e:
            logger.error(f"Failed to fetch telephony call cost: {e}")
            # Don't fail the whole cost calculation if telephony API fails

    total_cost_usd = Decimal(str(cost_breakdown["total"]))
    dograh_tokens = float(total_cost_usd * Decimal("100"))

    cost_info = {
        "cost_breakdown": cost_breakdown,
        "total_cost_usd": float(total_cost_usd),
        "actual_cost": actual_cost,
        "dograh_token_usage": dograh_tokens,
        "calculated_at": calculated_at
        or (workflow_run.created_at.isoformat() if workflow_run is not None else None),
        "call_duration_seconds": usage_info.get("call_duration_seconds", 0),
    }

    return cost_info


async def build_workflow_run_cost_info(workflow_run) -> dict | None:
    cost_info = await _build_usage_cost_snapshot(
        workflow_run.usage_info,
        workflow_run=workflow_run,
        include_telephony_cost=True,
        calculated_at=workflow_run.created_at.isoformat(),
    )
    if cost_info is None:
        return None
    return {
        **(workflow_run.cost_info or {}),
        **cost_info,
    }


async def save_workflow_run_cost_info(
    workflow_run_id: int, cost_info: dict | None
) -> None:
    if cost_info is None:
        return
    await db_client.update_workflow_run(run_id=workflow_run_id, cost_info=cost_info)


async def apply_workflow_run_usage_to_organization(
    workflow_run, cost_info: dict | None
) -> None:
    if cost_info is None:
        return

    org = await _get_pricing_organization(workflow_run)
    if not org:
        return

    await _update_organization_usage(
        org,
        float(cost_info.get("dograh_token_usage") or 0),
        float(cost_info.get("call_duration_seconds") or 0),
    )


async def apply_usage_delta_to_organization(
    workflow_run, usage_info: dict | None
) -> dict | None:
    org = await _get_pricing_organization(workflow_run)
    if not org:
        return None

    cost_info = await _build_usage_cost_snapshot(usage_info, organization=org)
    if cost_info is None:
        return None

    await _update_organization_usage(
        org,
        float(cost_info.get("dograh_token_usage") or 0),
        float(cost_info.get("call_duration_seconds") or 0),
    )
    return cost_info


async def calculate_workflow_run_cost(workflow_run_id: int):
    logger.debug("Calculating cost for workflow run")

    workflow_run = await db_client.get_workflow_run_by_id(workflow_run_id)
    if not workflow_run:
        logger.warning("Workflow run not found")
        return

    try:
        cost_info = await build_workflow_run_cost_info(workflow_run)
        if cost_info is None:
            return

        await save_workflow_run_cost_info(workflow_run_id, cost_info)

        try:
            await apply_workflow_run_usage_to_organization(workflow_run, cost_info)
        except Exception as e:
            org = await _get_pricing_organization(workflow_run)
            if org:
                logger.error(
                    f"Failed to update organization usage for org {org.id}: {e}"
                )
            else:
                logger.error(f"Failed to update organization usage: {e}")
            # Don't fail the whole cost calculation if usage update fails

        logger.info(
            f"Calculated cost for workflow run: ${cost_info['total_cost_usd']:.6f} USD ({cost_info['dograh_token_usage']} Dograh Tokens)"
        )
    except Exception as e:
        logger.error(f"Error calculating cost for workflow run: {e}")
        raise
