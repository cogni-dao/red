# Red sandbox execution

Red owns this toolbox and its solver policy. Operator tooling owns a **separate
sandbox workload/lease** for the same node ID. The ordinary private `deployment.services[]` declaration is placed in its own
lease by the operator catalog’s `isolated_services.sandbox` policy. **Do not flight
until that policy and control-plane support are deployed**: an older operator
would place the service beside the app. App and sandbox must have separate lease
lifecycles and substrate credentials.

## What this change provides

- The pinned execd **v1.1.0**, Caddy front door and hardening configuration from
  [Red PR #25](https://github.com/Cogni-DAO/red/pull/25). The daemon is PID 1,
  runs as UID/GID 10001, and refuses a missing/short token. Caddy exposes `/version`
  at port 8080 with the operator-injected build SHA. Upstream’s launcher strips
  credentials and applies its seccomp/no-new-privileges hardening floor. This is
  not independent tenant isolation. Ptrace-based debugging is denied by that floor.
- Python/pwntools, bash, gdb/binutils, curl, nmap, netcat, socat and jq.
- `core__sandbox_exec`: bounded background start, status, retained logs, interrupt,
  persistent `shell`, and `close_shell`.
- `core__sandbox_read_file` and `core__sandbox_write_file`: relative UTF-8 paths,
  parent creation, bounded output, and credential/sensitive-output withholding.
- All calls use the existing ToolRunner and graph launch path. Only red-solver
  lists the tools. The trusted capability also checks graph, authenticated actor,
  billing identity and thread key. It never accepts a URL/token/workspace from
  model arguments. Opaque command handles are signed for their workspace and
  expire after 24 hours; another thread cannot poll or interrupt them via the API.

No automatic command retry occurs. A lost/malformed acknowledgement returns
`unknown`; the command may already have executed. Do not replay it. A failed
persistent-shell allocation stays failed until explicitly closed; it is not
silently recreated. Shell bindings are process-local and do not survive an app
restart or transparently move between app replicas.

## Enablement and operator gates

The app derives its sandbox HTTPS origin from `APP_BASE_URL` using PR #25’s
service-host convention. `SANDBOX_BASE_URL` overrides it for local development
(HTTP is accepted only on loopback). Access also requires server-only
`SANDBOX_EXECD_TOKEN` (at least 32 characters). Trusted actor UUIDs are non-secret
configuration in `.cogni/sandbox-policy.json`, keyed by deployment lane. Missing
policy, unknown lanes, or empty actor lists disable access. Only persistent
candidate validation identities are enabled initially; preview/production deny
access. The environment variable SANDBOX_ALLOWED_ACTOR_IDS is no longer consumed.

The node-owned `.cogni/secrets-catalog.yaml` declares the token as `source: agent`
with a 32-byte hex generator. The owning operator materializer generates a missing
value and preserves existing bytes. Never manually seed or rotate this generated
credential through the vendor-value API. Verify the selected source carries the
catalog. The app and sandbox explicitly reference the same logical credential;
these redundant external-workload refs remain a documented platform limitation,
not a second secret authority. Prove projection and actual consumer activation.

The sandbox container receives **only** `SANDBOX_EXECD_TOKEN`; its entrypoint
maps that to execd's `EXECD_ACCESS_TOKEN`. Do not project LLM keys, database/Redis/
Temporal keys, app credentials, or provider control-plane credentials into it.
Use the operator delivery/materialization lane; never commit tokens or put them
in model context or command environments. A second materialization must preserve
the generated value. A storage receipt is not runtime proof. The isolated service currently uses a public HTTPS host with token authentication;
it is not a network-private endpoint.

The separate top-level `sandbox:` proposal in the original attachment is superseded
by operator [PR #2813](https://github.com/Cogni-DAO/cogni/pull/2813) and
[PR #2814](https://github.com/Cogni-DAO/cogni/pull/2814). Reuse PR #25’s private
service declaration and the standard immutable artifact-bundle build matrix.
The additional CI sandbox job exercises the image through production ToolRunner;
the required manifest check fails if that proof fails. Do not infer that a
successful app-only flight created or exercised the sandbox.

Platform prerequisite: [operator story.5093](https://cognidao.org/work/items/story.5093).
Red outcome: [story.0002](https://red.cognidao.org/work/items/story.0002).

Machine API clients use `POST /api/v1/chat/completions` with `graph_name:
"red-solver"` and the optional `state_key` extension (1–128 safe alphanumeric,
underscore or hyphen characters). Reuse it for the same conversation. The key is
scoped by authenticated actor and billing identity, never used as a path. Missing
thread context fails closed for sandbox tools. This does not introduce transcript
persistence into the stateless OpenAI-compatible API.

## Boundaries and limits

There is one sandbox workload per Red node, shared by trusted sessions. Workspace
paths are hashes of authenticated actor + billing account + thread key under
`/workspace`. This is **directory organization, not filesystem/process/tenant
isolation**: an arbitrary shell can address other directories or processes. File
path checks reject lexical traversal; symlinks and arbitrary shell execution are
not a qualified filesystem boundary. Never onboard untrusted tenants on this basis.

A separate lease protects the app lifecycle and prevents automatically sharing
its internal service network. It does **not** enforce outbound target scope.
`compute_egress_cidrs` admits provider NATs to operator substrate ports; it is not a
sandbox destination firewall. Until independently enforced target-only egress is
qualified, use shell only for local, self-owned fixtures. Graph prompts/actor
allowlists are not network enforcement. No hostile or third-party targets are
qualified by this PR. The original story's target-only egress acceptance remains
open, even after a successful command demonstration.

Command timeout is 30s by default, at most 120s. Only one persistent-shell call may
run per thread at a time; the client caps tracked shells at 64. Explicitly close
shells when finished. Processes, files and retained output remain subject to the
workload's memory/PID/storage quotas and lifecycle. File content and command
output are capped at 32 KiB. Oversized reads are withheld rather than exposing a
partial credential at the truncation boundary. The token is a service credential,
not a tenant security boundary. No sandbox credential or full endpoint is returned
in tool output; do not deliberately write credentials into generated files.

## Reproduce the runtime proof

From the repository root with Docker and workspace dependencies available:

```sh
pnpm packages:build
docker build -t red-sandbox:story-0002 services/sandbox
services/sandbox/validate.sh
```

The public `/readyz` handler probes execd `/ping` without credentials and maps
its authenticated-alive response to readiness. Execution routes remain token-gated.
The fixture requires this readiness handler as well as exact `/version` so a
missing handler cannot silently trigger the operator boot-close policy again.

The fixture runs the actual image non-root, with a read-only root, tmpfs scratch,
all capabilities dropped, no-new-privileges, and PID/memory/CPU limits. It generates
a disposable token, binds the service front door only on loopback, and removes the container on
exit. It exercises the **production capability through ToolRunner**: auth refusal,
file read/write, separate thread directories, trusted graph/actor gates,
persistent shell state, background lifecycle/logs/interrupt, signed command
ownership, traversal refusal, and ToolRunner's default-deny policy. It performs no
LLM calls and is not live candidate validation or proof of tenant isolation.

The app emits one metadata-only `adapter.sandbox.result` terminal event per
authorized operation, using the container's node-bound logger and run ID.
No commands, file content, handles, full URLs or tokens are logged. Read feature
proof back through the operator's node-scoped log API at the candidate build SHA.

Live release gate: exact candidate `/version` + readiness; authenticated agent API
solve; real command/file evidence; matching terminal events; only then operator
merge and production promotion. Do not report the original story complete until
its non-web solve and network containment acceptance are proven.

After Red's live proof, extract only the stable client/contracts/binding/base-image
mechanism into the template's published `@cogni-dao/sandbox` package. Keep Red's
CTF toolbox, target policy, graphs and opt-in declaration here.
