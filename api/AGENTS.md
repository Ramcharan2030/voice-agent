# API - Backend Service

FastAPI backend for the SPX Voice platform.

## Project Structure

```
api/
├── routes/           # API endpoint handlers
├── services/         # Domain logic, runtime systems, and extension seams
├── db/               # Database models and data access
├── schemas/          # Pydantic request/response schemas
├── tasks/            # Background jobs and post-call work
├── mcp_server/       # MCP surface exposed by the backend
├── utils/            # Shared utilities
├── alembic/          # Database migrations
└── tests/            # Test suite
```

## Where to Find Things

| Looking for...               | Go to...                                           |
| ---------------------------- | -------------------------------------------------- |
| API endpoints                | `routes/` - domain routers mounted under `/api/v1` |
| Workflow graph and node data | `services/workflow/`                               |
| Live pipeline runtimes       | `services/pipecat/`, `services/livekit/`           |
| Telephony providers/call flow| `services/telephony/`                              |
| Third-party integrations     | `services/integrations/`                           |
| Campaign and other domains   | `services/`                                        |
| Database access              | `db/`                                              |
| Request/response types       | `schemas/`                                         |
| Background jobs              | `tasks/`                                           |
| MCP backend surface          | `mcp_server/`                                      |
| Tests                        | `tests/`                                           |

## API Structure

- All routes are mounted at `/api/v1` prefix.
- Routes are organized by domain under `routes/`.
- Workflow execution spans `services/workflow/`, `services/pipecat/`, `services/livekit/`, and `tasks/`.
- Telephony is a full subsystem under `services/telephony/`, with provider-specific packages under `services/telephony/providers/`.
- Integrations extend through `services/integrations/`; package-specific rules should live in that subtree's own `AGENTS.md`.

## Routes vs Service Layer

Keep route handlers thin: parse/validate the request, resolve auth and `organization_id`, delegate, and shape the response. Domain logic belongs in `services/`. Keep DB access in `db/` clients.

## Organization Scoping

Most resources are scoped to an organization. Whenever you read or write an organization-scoped field, filter or validate by `organization_id`.

- Reading an org-scoped row by id: pass `organization_id=user.selected_organization_id` to the DB client or query through an org-scoped helper.
- Writing a foreign key that points at another org-scoped resource: fetch the referenced row with the user's `organization_id` and reject with 404 if it does not belong.
- Listing org-scoped resources: filter by `organization_id` at the query level.

For webhook callbacks, derive organization ownership from the request payload and validate that derivation explicitly.

## Development

```bash
uvicorn api.app:app --reload --port 8000
```
