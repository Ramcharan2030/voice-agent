from __future__ import annotations

"""Default workflow bootstrap for fresh SPX Voice organizations."""

import copy
from typing import Any

from loguru import logger

from api.db import db_client

DEFAULT_WORKFLOW_NAME = "Default Voice Assistant"
DEFAULT_WORKFLOW_GREETING = (
    "Hello, this is your SPX Voice assistant. How can I help you today?"
)

DEFAULT_WORKFLOW_DEFINITION: dict[str, Any] = {
    "nodes": [
        {
            "id": "start",
            "type": "startCall",
            "position": {"x": 0, "y": 0},
            "data": {
                "name": "Start",
                "greeting_type": "text",
                "greeting": DEFAULT_WORKFLOW_GREETING,
                "prompt": (
                    "Greet the caller once, then route them into the assistant. "
                    "Keep the opening short and wait for the caller's request."
                ),
                "is_start": True,
                "allow_interrupt": True,
                "add_global_prompt": False,
            },
        },
        {
            "id": "assistant",
            "type": "agentNode",
            "position": {"x": 260, "y": 0},
            "data": {
                "name": "Assistant",
                "prompt": (
                    "You are a concise, professional SPX Voice assistant. "
                    "Answer the caller's latest question directly, ask one clear "
                    "follow-up when more information is needed, and do not invent "
                    "facts, prices, policies, or promises. If the caller asks to "
                    "end the call, politely close the conversation."
                ),
                "allow_interrupt": True,
                "add_global_prompt": False,
            },
        },
        {
            "id": "end",
            "type": "endCall",
            "position": {"x": 520, "y": 0},
            "data": {
                "name": "End",
                "prompt": "Say exactly: Thank you for calling. Goodbye.",
                "is_end": True,
                "add_global_prompt": False,
            },
        },
    ],
    "edges": [
        {
            "id": "start-assistant",
            "source": "start",
            "target": "assistant",
            "data": {
                "label": "Continue",
                "condition": "After the opening greeting, continue the conversation.",
            },
        },
        {
            "id": "assistant-end",
            "source": "assistant",
            "target": "end",
            "data": {
                "label": "End Call",
                "condition": "Use when the caller is finished or asks to end the call.",
            },
        },
    ],
}


def build_default_workflow_definition() -> dict[str, Any]:
    return copy.deepcopy(DEFAULT_WORKFLOW_DEFINITION)


async def ensure_default_workflow_for_organization(
    *,
    user_id: int,
    organization_id: int,
) -> bool:
    """Create the starter workflow when an organization has no workflows."""

    workflows = await db_client.get_all_workflows_for_listing(
        organization_id=organization_id
    )
    if workflows:
        return False

    workflow = await db_client.create_workflow(
        DEFAULT_WORKFLOW_NAME,
        build_default_workflow_definition(),
        user_id,
        organization_id,
    )
    logger.info(
        "Created default SPX Voice workflow "
        f"workflow_id={workflow.id} organization_id={organization_id}"
    )
    return True


__all__ = [
    "DEFAULT_WORKFLOW_DEFINITION",
    "DEFAULT_WORKFLOW_GREETING",
    "DEFAULT_WORKFLOW_NAME",
    "build_default_workflow_definition",
    "ensure_default_workflow_for_organization",
]
