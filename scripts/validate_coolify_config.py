#!/usr/bin/env python3
"""Validate the environment values required by docker-compose.coolify.yaml."""

from __future__ import annotations

import os
import sys
from urllib.parse import urlsplit


PLACEHOLDER_FRAGMENTS = (
    "change-this",
    "generate-a-long-random-value",
    "example.com",
)


def value(name: str) -> str:
    return os.getenv(name, "").strip()


def is_placeholder(raw: str) -> bool:
    lowered = raw.lower()
    return not raw or any(fragment in lowered for fragment in PLACEHOLDER_FRAGMENTS)


def main() -> int:
    errors: list[str] = []

    for name in (
        "POSTGRES_PASSWORD",
        "REDIS_PASSWORD",
        "MINIO_ROOT_PASSWORD",
        "OSS_JWT_SECRET",
    ):
        raw = value(name)
        if is_placeholder(raw):
            errors.append(f"{name} must be set to a non-placeholder secret")
        elif len(raw) < 24:
            errors.append(f"{name} must contain at least 24 characters")

    app_url = value("APP_URL")
    if app_url:
        parsed = urlsplit(app_url)
        if parsed.scheme != "https" or not parsed.hostname:
            errors.append("APP_URL must be a complete HTTPS URL")
        if parsed.port:
            errors.append(
                "APP_URL is the public browser URL and must not include Coolify's "
                "internal :3010 port"
            )

    if value("VOICE_RUNTIME").lower() == "livekit":
        livekit_values = (
            value("LIVEKIT_URL"),
            value("LIVEKIT_CLIENT_URL"),
            value("LIVEKIT_API_KEY"),
            value("LIVEKIT_API_SECRET"),
        )
        if any(livekit_values) and not all(livekit_values):
            errors.append(
                "LiveKit is partially configured; set LIVEKIT_URL, "
                "LIVEKIT_CLIENT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET together"
            )

    if errors:
        print("Coolify configuration is not ready:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("Coolify configuration preflight passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
