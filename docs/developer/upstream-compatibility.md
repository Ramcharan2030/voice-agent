# Upstream Compatibility

SPX Voice is a public, cleaned fork of the Dograh voice-agent codebase. The
product name, default runtime settings, public documentation, and client-specific
behavior should be SPX Voice. At the same time, this repo should stay friendly
to upstream Dograh updates so security fixes, telephony improvements, workflow
changes, and SDK/codegen improvements can be imported with minimal friction.

## Compatibility Goals

- Keep a clear path for merging or cherry-picking upstream changes.
- Preserve upstream-compatible internal APIs where renaming would create churn
  without improving public SPX Voice behavior.
- Keep public SPX Voice branding clean: no client names, private recordings,
  transcripts, phone numbers, or deployment secrets in committed files.
- Document intentional Dograh-derived internals so future contributors do not
  rename them blindly and make future upstream imports harder.

## What Can Stay upstream-compatible

Some internal names may remain upstream-compatible until there is a deliberate
migration plan:

- Database fields and serialized API fields such as `dograh_token_usage` or
  `quota_dograh_tokens`, because renaming them can require migrations, generated
  client changes, and UI compatibility handling.
- SDK package/import paths such as `dograh_sdk` or `@dograh/sdk`, until SPX Voice
  publishes replacement SDK packages and compatibility shims.
- Pipecat fork integration classes that refer to Dograh-specific service names,
  especially where those names match upstream module imports.
- Helper function names used across routes/tests, such as quota checks, when
  renaming would produce a large mechanical diff with no behavior change.

These names are compatibility details, not SPX Voice branding. Do not expose
them in new user-facing docs, examples, UI copy, default env files, or generated
public setup instructions unless the compatibility reason is stated.

## What Must Be Removed Or Renamed

Always clean these before open-source release or upstream-sync commits:

- Client/project names from private deployments.
- Real phone numbers, recordings, raw transcripts, batch outputs, credentials,
  local `.tmp` data, and generated audio chunks.
- Hardcoded production URLs, buckets, webhook endpoints, or account IDs.
- Product-facing text that tells users this is Dograh instead of SPX Voice.
- Default room prefixes, agent names, telemetry names, or storage prefixes that
  include a private client or old product brand.

## Importing Upstream Changes

Recommended workflow:

1. Keep an `upstream` git remote pointing to the upstream repository if allowed by
   the maintainer workflow.
2. Prefer small cherry-picks or topic branches over huge merges.
3. Before applying upstream changes, run a search for private/client identifiers
   and SPX Voice branding regressions.
4. After applying upstream changes, regenerate API clients only when backend
   OpenAPI output changed.
5. Re-run targeted backend tests for the touched area and at least one
   smoke-check command:

```bash
rg -n -i "private-client-name|private-project-name|real-customer-phone|real-customer-email" .
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml config -q
python -m py_compile api/app.py
```

When a Dograh change conflicts with SPX Voice changes, prefer preserving the
SPX Voice public surface and adapting the upstream implementation behind it.

## Agent Guidance

Future agents should not treat every `dograh` string as a bug. Classify each
hit first:

- **Public branding leak**: rename to SPX Voice.
- **Private/client leak**: remove or replace with a neutral example.
- **Compatibility/internal schema**: leave in place unless the user asks for a
  full compatibility-breaking migration.
- **Upstream import path**: leave in place until replacement packages exist.

If in doubt, keep the internal compatibility name and add a short note rather
than doing a risky global rename.
