import hashlib
import hmac
import time

import pytest

from api.services.telephony.providers.vobiz.provider import VobizProvider


def _provider() -> VobizProvider:
    return VobizProvider(
        {
            "auth_id": "MA_TEST",
            "auth_token": "test-auth-token",
            "application_id": "APP_TEST",
            "from_numbers": ["910000000000"],
        }
    )


def _body() -> str:
    return (
        "CallUUID=call-test&From=910000000001&To=910000000000&"
        "Direction=inbound&CallStatus=ringing&ParentAuthID=MA_TEST"
    )


def _payload() -> dict[str, str]:
    return {
        "CallUUID": "call-test",
        "From": "910000000001",
        "To": "910000000000",
        "Direction": "inbound",
        "CallStatus": "ringing",
        "ParentAuthID": "MA_TEST",
    }


def _signed_headers(body: str) -> dict[str, str]:
    timestamp = str(int(time.time()))
    signature = hmac.new(
        b"test-auth-token",
        f"{timestamp}.{body}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "x-vobiz-signature": signature,
        "x-vobiz-timestamp": timestamp,
    }


@pytest.mark.asyncio
async def test_verify_inbound_signature_accepts_unsigned_vobiz_webhook():
    result = await _provider().verify_inbound_signature(
        "https://example.test/api/v1/telephony/inbound/run",
        _payload(),
        {},
        _body(),
    )

    assert result is True


@pytest.mark.asyncio
async def test_verify_inbound_signature_accepts_incomplete_vobiz_headers():
    result = await _provider().verify_inbound_signature(
        "https://example.test/api/v1/telephony/inbound/run",
        _payload(),
        {"x-vobiz-signature": "present-without-timestamp"},
        _body(),
    )

    assert result is True


@pytest.mark.asyncio
async def test_verify_inbound_signature_accepts_valid_complete_vobiz_headers():
    body = _body()

    result = await _provider().verify_inbound_signature(
        "https://example.test/api/v1/telephony/inbound/run",
        _payload(),
        _signed_headers(body),
        body,
    )

    assert result is True


@pytest.mark.asyncio
async def test_verify_inbound_signature_rejects_invalid_complete_vobiz_headers():
    body = _body()
    headers = _signed_headers(body)
    headers["x-vobiz-signature"] = "invalid"

    result = await _provider().verify_inbound_signature(
        "https://example.test/api/v1/telephony/inbound/run",
        _payload(),
        headers,
        body,
    )

    assert result is False


def test_normalize_call_cost_uses_current_inr_cdr_fields():
    result = VobizProvider._normalize_call_cost(
        {
            "data": {
                "billsec": 42,
                "cost": 0.45,
                "currency": "INR",
                "duration": 47,
                "status": "completed",
                "total_cost": 0.45,
            },
            "success": True,
        },
        source="cdr",
    )

    assert result["currency"] == "INR"
    assert result["cost_inr"] == 0.45
    assert result["cost_usd"] == 0.0
    assert result["duration"] == 42
    assert result["source"] == "cdr"


def test_normalize_call_cost_handles_legacy_minor_unit_cdr_fields():
    result = VobizProvider._normalize_call_cost(
        {
            "cost": 156,
            "currency": "USD",
            "ratePerMinute": 30,
            "billableSeconds": 312,
            "status": "answered",
        },
        source="legacy_call_endpoint",
    )

    assert result["currency"] == "USD"
    assert result["cost_usd"] == 1.56
    assert result["rate_usd_per_minute"] == 0.3
    assert result["duration"] == 312
