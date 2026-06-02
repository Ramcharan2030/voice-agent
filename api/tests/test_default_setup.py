from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api.schemas.user_configuration import UserConfiguration
from api.services.auth import depends as auth_depends
from api.services.configuration.registry import GoogleRealtimeLLMConfiguration
from api.services.workflow.defaults import build_default_workflow_definition
from api.services.workflow.dto import ReactFlowDTO
from api.services.workflow.workflow_graph import WorkflowGraph


def test_default_workflow_definition_is_valid():
    dto = ReactFlowDTO.model_validate(build_default_workflow_definition())
    graph = WorkflowGraph(dto)

    assert graph.start_node_id == "start"
    assert "assistant" in graph.nodes
    assert "end" in graph.nodes


@pytest.mark.asyncio
async def test_ensure_default_user_setup_creates_config_and_workflow(monkeypatch):
    default_config = UserConfiguration(
        is_realtime=True,
        realtime=GoogleRealtimeLLMConfiguration(
            provider="google_realtime",
            api_key="google-key",
            model="gemini-3.1-flash-live-preview",
            voice="Kore",
            language="en",
        ),
    )
    db = SimpleNamespace(
        get_user_configurations=AsyncMock(return_value=UserConfiguration()),
        update_user_configuration=AsyncMock(),
    )
    create_config = AsyncMock(return_value=default_config)
    ensure_workflow = AsyncMock()

    monkeypatch.setattr(auth_depends, "db_client", db)
    monkeypatch.setattr(
        auth_depends,
        "create_default_user_configuration",
        create_config,
    )
    monkeypatch.setattr(
        auth_depends,
        "ensure_default_workflow_for_organization",
        ensure_workflow,
    )

    user = SimpleNamespace(
        id=5,
        selected_organization_id=7,
        provider_id="local-user",
    )

    await auth_depends.ensure_default_user_setup(user)

    create_config.assert_awaited_once_with(5, 7, "local-user")
    db.update_user_configuration.assert_awaited_once_with(5, default_config)
    ensure_workflow.assert_awaited_once_with(user_id=5, organization_id=7)


@pytest.mark.asyncio
async def test_ensure_default_user_setup_preserves_existing_model_config(monkeypatch):
    existing_config = UserConfiguration(
        is_realtime=True,
        realtime=GoogleRealtimeLLMConfiguration(
            provider="google_realtime",
            api_key="existing-google-key",
            model="gemini-3.1-flash-live-preview",
            voice="Puck",
            language="en",
        ),
    )
    db = SimpleNamespace(
        get_user_configurations=AsyncMock(return_value=existing_config),
        update_user_configuration=AsyncMock(),
    )
    create_config = AsyncMock()
    ensure_workflow = AsyncMock()

    monkeypatch.setattr(auth_depends, "db_client", db)
    monkeypatch.setattr(
        auth_depends,
        "create_default_user_configuration",
        create_config,
    )
    monkeypatch.setattr(
        auth_depends,
        "ensure_default_workflow_for_organization",
        ensure_workflow,
    )

    user = SimpleNamespace(
        id=5,
        selected_organization_id=7,
        provider_id="local-user",
    )

    await auth_depends.ensure_default_user_setup(user)

    create_config.assert_not_awaited()
    db.update_user_configuration.assert_not_awaited()
    ensure_workflow.assert_awaited_once_with(user_id=5, organization_id=7)
