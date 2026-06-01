# Contributing to SPX Voice

Thanks for helping improve SPX Voice. This project is a Docker-first,
open-source voice AI platform with a FastAPI backend, Next.js dashboard,
Pipecat runtime, and optional LiveKit runtime.

## Good First Steps

- Read [README.md](README.md) for the quick start.
- Read [docs/contribution/setup.mdx](docs/contribution/setup.mdx) for local development.
- Read [docs/developer/upstream-compatibility.md](docs/developer/upstream-compatibility.md) before large renames or upstream imports.

## How To Contribute

- Open issues for bugs, missing docs, or deployment friction.
- Keep pull requests focused and easy to review.
- Do not commit secrets, `.env` files, recordings, transcripts, caches, or generated runtime output.
- Prefer the existing backend, frontend, and Docker patterns unless a change clearly needs a new pattern.

## Development

Use the one-command local Docker path for a first run:

```bash
bash start.sh
```

PowerShell:

```powershell
.\start.ps1
```

For direct source development, follow the setup guide in `docs/contribution/setup.mdx`.
