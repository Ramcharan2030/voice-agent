# SPX Voice - Project Overview

SPX Voice is an open-source voice AI platform for building and deploying conversational agents with telephony, WebRTC, Pipecat, and LiveKit support.

## Project Structure

```
spx-voice/
+-- api/              # Backend - FastAPI application
+-- ui/               # Frontend - Next.js application
+-- scripts/          # Helper scripts for local development
+-- docs/             # Documentation
+-- pipecat/          # Pipecat framework (git submodule)
+-- docker-compose.yaml       # Production/OSS deployment
+-- docker-compose-local.yaml # Local development services
```

## Tech Stack

- **Backend**: Python with FastAPI
- **Frontend**: Next.js 15 with React 19, TypeScript, Tailwind CSS
- **Database**: PostgreSQL with SQLAlchemy (async)
- **Cache/Queue**: Redis with ARQ for background tasks
- **Storage**: MinIO (S3-compatible) for audio files
- **Voice runtimes**: Pipecat and LiveKit

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
