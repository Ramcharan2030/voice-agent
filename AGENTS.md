# SPX Voice - Project Overview

SPX Voice is an open-source voice AI platform for building and deploying conversational agents with telephony and LiveKit support.

## Project Structure

```
spx-voice/
+-- api/              # Backend - FastAPI application
+-- ui/               # Frontend - Next.js application
+-- scripts/          # Helper scripts for local development
+-- docs/             # Documentation
+-- docker-compose.yaml       # Production/OSS deployment
+-- docker-compose-local.yaml # Local development services
```

## Tech Stack

- **Backend**: Python with FastAPI
- **Frontend**: Next.js 15 with React 19, TypeScript, Tailwind CSS
- **Database**: PostgreSQL with SQLAlchemy (async)
- **Cache/Queue**: Redis with ARQ for background tasks
- **Storage**: MinIO (S3-compatible) for audio files
- **Voice runtime**: LiveKit

## Upstream Compatibility

SPX Voice keeps some internal upstream-compatible names to make future upstream
upstream fixes easier to import. Public branding and defaults should say SPX
Voice, but do not perform broad upstream-compatibility renames unless there is a
specific migration plan. Read `docs/developer/upstream-compatibility.md`
before upstream merges, SDK/package renames, or schema field renames.

## Environment Configuration

- `api/.env` - Backend environment variables. Source this when running diagnostic scripts or one-off services against the dev DB.
- `api/.env.test` - Test-only environment variables. Source this when running pytest so tests hit the test DB and never dev/prod credentials.
- `ui/.env` - Frontend environment variables.

Typical invocation:

```bash
# Tests
source venv/bin/activate && set -a && source api/.env.test && set +a && python -m pytest api/tests/...

# Diagnostics / scripts
source venv/bin/activate && set -a && source api/.env && set +a && python -m api.services.admin_utils.local_exec
```

## Product Mental Model

SPX Voice runs voice agents as versioned workflow graphs. A workflow is a
React Flow-style JSON document persisted on `WorkflowModel` and snapshotted in
`WorkflowDefinitionModel`. The current published version is the live behavior;
drafts are editable without changing live inbound calls.

The OSS product is LiveKit + Gemini realtime first. Traditional STT/LLM/TTS is
still supported, but it should be treated as secondary unless the task explicitly
asks for that mode. Fresh deployments should work when a Gemini key is available
through `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, or
`GOOGLE_AI_API_KEY`.

First-run setup is expected to create:

- a model configuration, preferably Gemini realtime;
- a valid starter workflow named `Default Voice Assistant`;
- Vobiz/LiveKit routing that can attach active phone numbers to that workflow.

If a user reports "outbound works but inbound does not", first check whether a
`WR-LK-IN-*` workflow run is created. No `WR-LK-IN-*` run means the call did not
reach a LiveKit dispatch/worker. A `WR-LK-IN-*` run that starts and then fails
points to workflow/model/runtime configuration.

## Workflow Graphs

Workflow definitions live in JSON shaped like:

```json
{
  "nodes": [
    {
      "id": "start",
      "type": "startCall",
      "position": { "x": 0, "y": 0 },
      "data": {
        "name": "Start",
        "prompt": "Greet the caller and ask how you can help.",
        "greeting_type": "text",
        "greeting": "Hello, this is your SPX Voice assistant.",
        "is_start": true,
        "allow_interrupt": true
      }
    }
  ],
  "edges": [
    {
      "id": "start-next",
      "source": "start",
      "target": "next",
      "data": {
        "label": "Continue",
        "condition": "After greeting, continue."
      }
    }
  ]
}
```

Important rules:

- Validate definitions with `ReactFlowDTO.model_validate(definition)` and
  `WorkflowGraph(dto)` before saving generated or default workflows.
- Every conversational workflow needs exactly one `startCall` node with
  `data.is_start = true`.
- `agentNode` and `endCall` require a non-empty `prompt`.
- `endCall` nodes are terminal and should not have outgoing edges.
- Edges need meaningful `label` and `condition` text because transition tools
  are generated from them.
- Keep node ids stable when editing existing workflows; run logs and UI state
  are easier to understand when ids do not churn.
- Do not put API keys inside node prompts or workflow JSON. Model keys belong in
  user configurations or `workflow_configurations.model_overrides`.

Default workflow bootstrap is in `api/services/workflow/defaults.py`. If you
change it, add or update tests that validate the graph and ensure first-run user
setup still creates it.

## Creating Or Modifying Agent Workflows

Use existing service and DB APIs rather than hand-writing database rows:

- Create a new workflow with `db_client.create_workflow(name, definition, user_id, organization_id)`.
- Save edits as a draft through `db_client.update_workflow(...)`, which delegates
  versioned changes to `save_workflow_draft`.
- Publish with `db_client.publish_workflow_draft(workflow_id)` when the draft
  should become live.
- Fetch draft-or-published state carefully. UI edit paths usually merge against
  the active draft if one exists, otherwise the released definition.

When adding new node types:

- Define/extend node DTOs in `api/services/workflow/dto.py`.
- Register node specs under `api/services/workflow/node_specs/`.
- Make `WorkflowGraph` enforce any new graph constraints.
- Update the UI renderer/editor under `ui/src/components/flow/`.
- Add DTO and graph constraint tests in `api/tests/`.

## Model Configuration

Global user model config is represented by `api.schemas.user_configuration.UserConfiguration`.
Provider schemas and defaults live in `api/services/configuration/registry.py`
and `api/services/configuration/defaults.py`.

Realtime-specific notes:

- `is_realtime = true` means the LiveKit worker should use the realtime section.
- Gemini realtime provider id is `google_realtime`.
- Default realtime model is `gemini-3.1-flash-live-preview`.
- In realtime mode, incomplete STT/TTS sections without API keys are ignored.
  Do not reintroduce validation that requires Deepgram/ElevenLabs for Gemini
  realtime calls.
- The LiveKit worker supports only providers implemented in
  `api/services/livekit/worker.py`. A provider appearing in the UI registry does
  not automatically mean it can run in LiveKit.

Workflow-level overrides live under:

```json
{
  "model_overrides": {
    "is_realtime": true,
    "realtime": {
      "provider": "google_realtime",
      "model": "gemini-3.1-flash-live-preview",
      "voice": "Kore",
      "language": "en"
    }
  }
}
```

Never save masked placeholders as real API keys. Use the helpers in
`api/services/configuration/masking.py`:

- `mask_user_config`
- `mask_workflow_configurations`
- `merge_user_configurations`
- `merge_workflow_configuration_api_keys`
- `check_for_masked_keys`
- `check_workflow_configurations_for_masked_keys`

If you add a config response field used by the UI, update or regenerate
`ui/src/client/types.gen.ts` and verify with `npm run build`.

## LiveKit And Vobiz Call Flow

Outbound test calls:

1. `POST /api/v1/telephony/initiate-call`
2. API creates a `WR-LK-OUT-*` run.
3. API creates a LiveKit room, agent dispatch, and SIP participant.
4. LiveKit worker receives dispatch metadata and runs the workflow.

Inbound Vobiz calls:

1. Vobiz routes the DID to the LiveKit SIP inbound host.
2. LiveKit matches the inbound trunk and dispatch rule.
3. LiveKit worker logs `[LiveKit] dispatch received`.
4. Worker waits for SIP participant, then creates a `WR-LK-IN-*` run.
5. Worker resolves the workflow from dispatch metadata and executes the
   published workflow definition.

Vobiz + LiveKit provisioning is split across:

- `api/routes/livekit.py` - setup wizard API and runtime settings.
- `api/services/livekit/vobiz.py` - Vobiz API calls, LiveKit SIP trunks, dispatch rules.
- `ui/src/components/telephony/VobizLiveKitSetupWizard.tsx` - guided UI setup.

The setup route should be forgiving for fresh installs: if no inbound workflow
is explicitly selected, it should use the starter workflow when possible. If no
inbound numbers get a workflow id, inbound calls will not know which agent to
run.

## Coolify, URLs, And MinIO

Coolify exposes generated domain variables such as `SERVICE_URL_UI_3010` and
`SERVICE_FQDN_UI_3010`. Public URL resolution is centralized in
`api/utils/public_url.py`; do not scatter new localhost-to-domain logic around
the codebase.

Important deployment rules:

- `BACKEND_URL` in the UI container should stay internal, usually `http://api:8000`.
- Browser-facing URLs should come from `APP_URL`, `BACKEND_API_ENDPOINT`,
  `UI_APP_URL`, or Coolify service variables.
- The Coolify compose does not run `cloudflared`; Cloudflare tunnel warnings are
  local-compose behavior, not required for Coolify.
- MinIO internal endpoint is `minio:9000`. Browser-facing MinIO URLs can use the
  UI domain because `ui/next.config.ts` proxies `/<MINIO_BUCKET>/*` to MinIO.
- For custom storage or custom buckets, keep `MINIO_BUCKET`,
  `MINIO_PUBLIC_ENDPOINT`, and the UI rewrite in sync.

## Runtime Failure Visibility

LiveKit runtime failures should be visible from workflow runs, not only from
container logs. When adding failure handling in the worker, prefer compact
events under `workflow_run.logs.livekit_events` and useful annotations such as
`annotations.livekit_startup_error`.

Useful log milestones:

- `[LiveKit] dispatch received` - LiveKit assigned a job to the worker.
- `[LiveKit] SIP participant connected` - inbound/outbound participant joined.
- `opening_audio_cache_failed` event - Gemini opening audio cache failed, but
  the agent should fall back to TTS.
- `startup_failed` event - session/model/worker startup failed before the call
  could run normally.

## Testing Checklist

For backend changes, prefer focused tests plus a compile pass:

```powershell
python -m compileall api/routes api/services
$env:DATABASE_URL='postgresql+asyncpg://postgres:postgres@localhost:5432/spx_voice_test'
$env:REDIS_URL='redis://localhost:6379/0'
$env:ENVIRONMENT='test'
uv run --python 3.12 --with-requirements api/requirements.txt --with pytest --with pytest-asyncio --with python-dotenv python -m pytest api/tests/test_default_setup.py
```

For UI changes:

```powershell
cd ui
npm ci
npm run build
```

For workflow/default setup changes, include tests that cover:

- default workflow graph validates through `ReactFlowDTO` and `WorkflowGraph`;
- `ensure_default_user_setup` creates config and workflow only when needed;
- Vobiz setup attaches active numbers to an inbound workflow;
- masked API keys cannot be persisted as real keys;
- LiveKit worker records startup/opening fallback failures.
