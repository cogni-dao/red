# api · AGENTS.md

> Scope: this directory only. Keep ≤150 lines. Do not restate root policies.

## Metadata

- **Owners:** @derek @core-dev
- **Last reviewed:** 2026-10-29
- **Status:** draft

## Purpose

HTTP API endpoints using Next.js App Router. Contract-validated entry points that delegate to feature services.

## Pointers

- [App AGENTS.md](../AGENTS.md)
- [Architecture](https://github.com/cogni-dao/cogni/blob/2321821e61dd12aa0cf75d235bd668ff65739109/docs/spec/architecture.md)
- [Feature Development Guide](https://github.com/cogni-dao/cogni/blob/2321821e61dd12aa0cf75d235bd668ff65739109/docs/guides/feature-development.md)

## Boundaries

```json
{
  "layer": "app",
  "may_import": ["features", "contracts", "shared"],
  "must_not_import": [
    "adapters/server",
    "adapters/worker",
    "core",
    "ports",
    "components"
  ]
}
```

## Public Surface

- **Exports:** none
- **Routes (if any):**
  - `/api/auth/[...nextauth]` [GET, POST]
  - `/api/setup/verify` [POST] - DAO formation verification
  - `/api/internal/billing/ingest` [POST] - LiteLLM generic_api callback receiver (bearer auth, Docker-internal only)
  - `/api/internal/ops/governance/schedules/sync` [POST] - deploy-time governance sync trigger (bearer auth)
  - `/api/v1/chat/completions` [POST] - OpenAI-compatible chat completions (streaming + non-streaming, `cogni_status` extension); see [completions spec](https://github.com/cogni-dao/cogni/blob/2321821e61dd12aa0cf75d235bd668ff65739109/docs/spec/completions-api.md)
  - `/api/v1/ai/chat` [POST] - streaming chat with server-authoritative thread persistence
  - `/api/v1/activity` [GET]
  - `/api/v1/identity/bindings/import/start` [POST] - mint a session-owned nonce and return the pinned operator broker URL
  - `/api/v1/identity/bindings/import` [POST] - verify and consume an operator identity attestation into this node's binding ledger
  - `/api/v1/public/attribution/epochs` [GET] - closed epochs list (public, no auth)
  - `/api/v1/public/attribution/epochs/[id]/user-projections` [GET] - closed epoch user projections (public)
  - `/api/v1/public/attribution/epochs/[id]/claimants` [GET] - closed epoch claimant attribution (public)
  - `/api/v1/public/attribution/epochs/[id]/statement` [GET] - epoch statement (public)
  - `/api/v1/attribution/epochs` [GET] - all epochs (SIWE auth)
  - `/api/v1/attribution/epochs/[id]/activity` [GET] - epoch activity events (SIWE auth)
  - `/api/v1/attribution/epochs/[id]/claimants` [GET] - claimant-aware finalized attribution (SIWE auth)
  - `/api/v1/attribution/epochs/[id]/user-projections` [GET, PATCH=410] - read per-user unsigned projections; edits are deprecated
  - `/api/v1/attribution/epochs/[id]/review-subject-overrides` [GET, PATCH, DELETE] - review-time subject overrides (SIWE + approver)
  - `/api/v1/attribution/settlement-lifecycle` [GET] - settlement and chain-proven publication lifecycle (SIWE auth)
  - `/api/v1/attribution/epochs/[id]/pool-components` [POST] - record pool component (SIWE + approver)
  - `/api/v1/users/me` [GET, PATCH] - current profile
  - `/api/v1/users/me/ownership` [GET] - current ownership summary derived from linked identities
  - `/api/v1/work/items` [GET, POST] - list or create node-local Dolt work items (SIWE or agent bearer auth)
  - `/api/v1/work/items/[id]` [GET, PATCH, DELETE] - read, update, or delete a node-local Dolt work item (SIWE or agent bearer auth)
  - `/api/v1/work/items/[id]/claims` [POST, DELETE] - acquire or release an authenticated principal+run lease
  - `/api/v1/work/items/[id]/heartbeat` [POST] - refresh an authenticated principal+run lease
  - `/api/v1/work/items/[id]/coordination` [GET] - read lease and next-action coordination state
  - `/api/v1/knowledge/domains/[domain]` [GET, PATCH, DELETE] - authenticated domain read/update/delete-if-empty; same permission as collection POST
  - `/api/v1/knowledge/index` [GET] - content-free knowledge routing projection with optional useWhen filter
  - `/api/v1/agent/register` [POST] - unauthenticated machine actor registration (returns Bearer API key)
  - `/api/v1/agent/runs` [GET] - machine-authenticated run list
  - `/api/v1/agent/runs/[runId]/stream` [GET] - machine-authenticated run stream SSE
  - `/api/v1/ai/runs/[runId]/ui-stream` [GET] - session-authenticated AI SDK chat replay stream
- **Files considered API:** v1/_/route.ts, admin/_/route.ts

## Responsibilities

- This directory **does**: validate HTTP requests/responses with contracts; delegate to features
- This directory **does not**: contain business logic, direct port usage, or data transformations

## Usage

```bash
curl -X POST http://localhost:3000/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}'
```

## Standards

- All routes must validate with contract schemas
- Parse input before processing, parse output before responding
- Use NextResponse for consistent HTTP responses

## Dependencies

- **Internal:** contracts (for validation), shared (for types)
- **External:** next (NextResponse)

## Change Protocol

- Update this file when **Routes** change
- Bump **Last reviewed** date
- Ensure contract tests pass

## Notes

- v1 API prefix for versioned product routes
- `v1/admin/ai-access` is an ADMIN-area route (a session or a bearer, through the one admin check; the only door for node-admin writes): `GET` lists node AI, `POST`/`DELETE` allow or remove a node AI permission for a node-admin, through `requireAdminSession()` and `NodeAdminPort` (both inside `v1/admin/_lib/ai-access-route.ts`, the admin builder; the status and body of every call come from `adminAiAccessHttp` in `@cogni/agent-grants/http`). A session and a bearer reach the same route and the same `agentAuthority.adminCheck` (ONE_ADMIN_CHECK). `v1/agent-access/mine` still calls `refuseNonSession()` (`_lib/auth/human-plane.ts`) first, inside the `mineRoute` builder (`app/_lib/agent-access/routes.ts`), before it reads the body (`mineHttp` in `@cogni/agent-grants/http` then decides) and is the last session-only route (task.0140 follow-up). A header that is not a signed or revocable agent bearer, with no session cookie, gets 401 from `proxy.ts` before the route runs; no authority is granted either way.
- Account grants (task.5465, one `agent_roles` row for node and account alike). `v1/agent-access/mine` is a HUMAN-plane route (session only; `refuseNonSession()` first, so any `Authorization` header is 403 `human_session_required`): `GET` lists the AIs that may act on the signed-in person's OWN account (this node's AI Off until On, outside AIs On), `POST` turns one On (an outside AI's ask by its one-time `token`, or this node's own AI directly by `principalUserId` + `scope`; a grant has no end date and lasts until Off, like a node permission), `DELETE` turns one Off (`rowId`) or dismisses an ask (`token` + `deny`). `POST v1/agent-access/mine/preview` and `POST v1/admin/ai-access/preview` take a link token (body only, never a URL) and return the waiting ask as a table row, or one 404 for a wrong-kind, used, expired or unknown token. The approver is the session and the account is the one that person owns: a body never names either, and a node-admin session adds nothing (APPROVER_FOLLOWS_RESOURCE, ONE_GATE = `canApprove` in `@cogni-dao/agent-grants`). `POST v1/agent/access-requests` (AI plane) returns `approvalUrl`: the one-time link to `/profile#agent-request=<token>` for an account scope or `/admin/ai-access#agent-request=<token>` otherwise, picked by the scope's declared kind. `GET v1/accounts/{accountId}/credits` is the gated read (`sameDoor: core__account_credits_read` + `sameDoorAccountParam: accountId`): the owner by session or an agent with a live grant for exactly that account, else ONE 404 (`not_found`), read in an app-role tenant transaction as the caller so row-level security (`agent_has_scope`) repeats the app's test.
- The agent access routes (`v1/agent/access-requests`, `v1/agent/me`, `v1/agent-access/mine*`, `v1/admin/ai-access*`, `v1/accounts/{accountId}/credits`) are thin: each keeps auth and the response object and calls one core from `@cogni/agent-grants/http` (task.0175). A new agent access route adds its core to the package first.
