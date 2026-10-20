# Red sandbox ACI integration

**Agent execution is unavailable in every environment.** PR #26 contains the
execd transport and normal tool contracts/bindings, but the application does not
inject a working sandbox capability. There is no proven live sandbox-agent run,
restricted-egress result, or non-web solve.

## Existing mechanisms reused

- `ToolContract` defines exec/read/write inputs and bounded results.
- `createToolBindings` / `createBoundToolSource` provide the ordinary capability
  injection path. The existing unavailable capability is the application default.
- `ToolRunner` remains the single policy/validation/execution/redaction/event path.
  No sandbox-specific executor, role system, caller allowlist or policy file exists.
- Existing `GraphRunRequest.stateKey`, authenticated `ExecutionContext` and the
  canonical `/api/v1/ai/chat` thread surface remain authoritative. The PR adds no
  completions-specific `state_key` extension or sandbox-only ALS fields.

A graph's tool list determines visibility; capability injection supplies an
implementation. Neither establishes the caller's permission to execute commands.

## Blocking shared authorization decision

Current `ToolPolicyContext` carries only `runId`. The in-process provider derives
its policy from graph tool IDs; it does not resolve caller permissions. Scheduler
execution grants validate graph/task dispatch scopes and are not an issued shell
permission for interactive callers. Ledger approvers govern attribution, not
shell execution. Red has no OpenFGA authorization integration. None can safely be
reinterpreted as shell permission merely to enable this feature.

**Recommended decision:** use the existing ToolRunner policy enforcement point
with a shared, authoritative caller/action authorization decision, supplied through
trusted execution context. Define controlled permission issuance, revocation and
node/environment/tenant binding there. Do not implement another Red-only role
framework or assume every authenticated caller is authorized. The platform must
select/approve that authority before a real sandbox capability is injected.

Separately, the shared workspace binding must resolve authenticated owner/thread
plus node, environment, tenant and generation, with expiry, ownership validation
per operation and acquisition/concurrency rules. A client-supplied thread key,
workspace directory, graph ID or transport credential is not that authority.

Until those decisions are implemented, all three sandbox bindings return
`unavailable`, including for validation accounts and callers holding valid node
sessions. No candidate-only bypass is provided.

## Genuine sandbox adapter responsibilities

`ExecdClient` implements the execd HTTP/SSE/file/session protocol, bounded output,
timeouts, retained command logs, signal/cancel and persistent shells. Its
workspace-bound command handles are signed and expire after 24 hours. These are
protocol protections, not hostile-session isolation or a durable workspace broker.

`bindExecdWorkspace` adapts a trusted workspace binding to `SandboxCapability` and
preserves ambiguous-execution results as `unknown`; it makes no permission
decision. Do not retry an ambiguous command. The app does not construct this
binding. Shell mappings are process-local and do not survive an app restart.

The image retains execd as non-root PID 1, the upstream hardening launcher,
credential stripping from child environments and Caddy's exact `/version` and
public `/readyz`. Readiness probes execd without placing its credential in Caddy.

## Secrets and deployment

Red's `.cogni/secrets-catalog.yaml` declares `SANDBOX_EXECD_TOKEN` as `source: agent`
with a hex/32-byte generator. The owning operator materializer generates missing
bytes and preserves existing values. Never manually seed, read back into model
context, or rotate this generated key through the vendor-value API.

Only the sandbox verifier declares this credential while application execution
is disabled. There is no app-side token reference, hardcoded actor identity or
actor-list secret. When shared authorization is implemented, project matching
bytes only to the authorized adapter and verifier. Explicit external-workload
refs remain the documented catalog/projection duplication gap.

Deploy through the operator's normal immutable-artifact flight path. An OpenBao
receipt, healthy app, image publication or runtime curl is not agent E2E proof.
Operator recovery of a boot-closed lease is distinct from routine secret refresh.

## Required live acceptance

The original story.0002 acceptance remains unchanged:

1. A real authenticated red-solver graph writes a script, runs it, reads its output
   and answers from that output; another turn reuses the authorized workspace.
2. Persistent shell state and bounded background start/poll/log/signal work; another
   owner is denied. Record exact app/runtime identity and run-correlated evidence.
3. Independently enforced authorized-host-only egress succeeds for the target and
   blocks other destinations. Prompt instructions and source-NAT allowlists do not
   enforce sandbox destination scope.
4. The agent solves a tool-requiring non-web challenge on the live environment,
   with feature evidence in Loki at the deployed build.

Directory separation and signed API handles do not establish hostile filesystem,
process or tenant isolation. Keep arbitrary/untrusted sessions disabled until the
runtime trust boundary and containment are qualified.

## Local transport fixture

```sh
pnpm packages:build
docker build -t red-sandbox:story-0002 services/sandbox
services/sandbox/validate.sh
```

This exercises a local fixture-owned adapter through shared contracts/ToolRunner,
including readiness, credentials, files and process protocol. It bypasses no
application authorization because it is not an application caller. It proves
neither authorized live agent functionality nor the acceptance above.

Work: https://red.cognidao.org/work/items/story.0002
