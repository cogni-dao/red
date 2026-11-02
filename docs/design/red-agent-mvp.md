# Red Agent MVP — Research & Design

**Status:** draft design for review · **Author:** agent · **Date:** 2026-10-13
**Question:** What is a repeatable LangGraph agent system that (a) accumulates public hacking
challenges, (b) assigns an AI agent to one target and solves it, (c) operates with top-0.1%
security-researcher discipline?

---

## TL;DR

- **The execution spine is already here and reusable.** Graph catalog + `GraphExecutorPort`
  routing, billing/telemetry, the ALS `CogniCompletionAdapter`, deny-by-default tool policy,
  MCP tool integration, cron `schedules` + Temporal + the `graph_runs` ledger. We do **not**
  rebuild any of that.
- **Three real gaps block a CTF agent:** (1) **no attack tooling** — there is no HTTP-request,
  shell/exec, or scratch-filesystem tool (only Tavily web_search, GitHub, Playwright-over-MCP);
  (2) **no durable/checkpointed state** — graphs are single-shot `invoke()`, no saver, no resume;
  (3) **no long-horizon controlled loop** library — only the `research` graph hand-wires a cyclic
  `StateGraph` with iteration caps (our template).
- **Pareto MVP = one new graph + a sandboxed exec tool + a scope/PII guardrail + 2 small tables,
  pointed at a self-hosted OWASP Juice Shop.** Juice Shop is the unlock: we own the box (clean
  authorization), `GET /api/Challenges` gives a machine-readable target list **and** reports
  solved-state, so the agent self-verifies with zero third-party ToS risk.
- **Defer** true checkpoint/resume, multi-platform accumulation, HTB/Root-Me integration, and
  sub-agent parallelism to later phases.

---

## 1. Current capabilities — critical analysis (reuse vs. gap)

Everything LangChain lives in `packages/langgraph-graphs` (invariant `NO_LANGCHAIN_IN_SRC`).
Tools are pure zod `BoundTool`s in `packages/ai-tools`. The runtime is ALS-based and
billing-integrated. Concretely:

**Reuse as-is (the spine):**

| Capability | Where | Note |
|---|---|---|
| Graph registration | `packages/langgraph-graphs/src/catalog.ts` | one `LANGGRAPH_CATALOG` entry per graph (id `langgraph:<name>`) |
| Graph factory idiom | `graphs/<name>/graph.ts` | pure `createXGraph({llm, tools})`; `createReactAgent` (11/13 graphs) or hand-wired `StateGraph` |
| LLM calls | `runtime/cogni/completion-adapter.ts` | `CogniCompletionAdapter` — every call billed/streamed, model from `configurable.model`; graphs never touch a provider SDK |
| Tool contract | `ai-tools/src/types.ts`, `catalog.ts` | zod `BoundTool` → wrapped to LangChain `DynamicStructuredTool` at graph layer |
| Tool policy | `ai-core/src/tooling/runtime/tool-policy.ts`, `tool-runner.ts` | **deny-by-default** allowlist, mandatory output `redact()`, per-tool `effect` tag |
| MCP integration | `runtime/mcp/client.ts`, `config/mcp.servers.json` | stdio/http/sse external tool servers — the sanctioned escape hatch (Playwright already reaches live URLs) |
| Scheduling | `db-schema/scheduling.ts` (`schedules`) + Temporal Schedules | `SCHEDULES_OVER_CRON`: a `schedules` row + Temporal Schedule object created atomically; each tick starts `GraphRunWorkflow` under the node tenant. No cron/worker code here |
| Run invocation | `completion.server.ts` (`ONE_RUN_EXECUTION_PATH`) | both streaming + immediate runs start `GraphRunWorkflow` via Temporal with an `execution_requests` idempotency claim — never inline `executor.runGraph()` |
| Sandboxed exec | `app/src/adapters/server/sandbox/sandbox-runner.adapter.ts` + `sandbox:` provider namespace | an existing sandbox-execution surface + graph provider — a reuse candidate for the attack-exec tool (see §6) |
| Run ledger | `graph_runs`, `execution_requests`, `execution_grants` | canonical status/retry/trace ledger + idempotency + durable authz |
| Observability | Langfuse trace + PostHog + Redis event stream | free per run |

**The three gaps we must close:**

1. **No attack surface tooling (the big one).** `TOOL_CATALOG` is 21 `core__*` tools, all benign:
   `web_search` is Tavily-only (can't hit an attacker-chosen host/port/method), VCS is GitHub-only,
   repo tools are read-only over *our* git. **There is no generic HTTP request tool, no shell/exec,
   no code interpreter, no scratch filesystem.** An agent literally cannot `curl` a target today.
   The prior CTF wins (see `ctf-file-upload-rce` memory) were a *human* driving Claude Code's Bash
   tool — exactly the capability our harness lacks.

2. **No durable/resumable state.** Repo-wide there is **zero** `MemorySaver`/`PostgresSaver`/
   `checkpointer`/`interrupt()`. Graphs are single-shot `invoke()`; `stateKey` is plumbed but the
   InProc adapter ignores it. A multi-hour solve that crashes restarts from scratch.

3. **No long-horizon controlled-loop pattern, only a template.** `createReactAgent` gives an
   uncontrolled ReAct loop (default recursion limit). The only example of an explicit cyclic
   `StateGraph` with per-node iteration budgets is `graphs/research/graph.ts` (supervisor↔tools
   loops, `MAX_SUPERVISOR_ITERATIONS` etc.). That file is our blueprint for a recon→exploit→verify
   loop with hard stop conditions.

---

## 2. MVP target choice — self-hosted OWASP Juice Shop

The hardest part of autonomous offensive security is **authorization**. We sidestep it entirely
in v0 by attacking infrastructure **we own**:

- `docker run -p 3000:3000 bkimminich/juice-shop` → we own the box, so the attack is unambiguously
  in-scope. No bug-bounty ToS, no VPN, no third party.
- **Machine-readable enumeration:** `GET /api/Challenges` returns JSON of every challenge **with
  live solved-state** — perfect for the accumulator *and* for automated success verification
  (the agent proves it solved a challenge by the box flipping it to solved).
- Layer in **PortSwigger Web Security Academy** (isolated, bounty-excluded, intended-to-attack) and
  **VulnHub VMs** (offline isolated lab) as later target sources.
- **Explicitly exclude TryHackMe** — its AUP bans AI agents outright. Treat **HackTheBox** consumer
  automation and **Root-Me** automated solving as needing ToS review before use.

This makes "accumulate public hacking challenges" concrete and legal for v0: enumerate Juice Shop's
own challenge API into our `red_challenges` table.

---

## 3. Ethical operating doctrine (what "never exposing XYZ" means)

Distilled from HackerOne, Bugcrowd, CERT/CC CVD, PTES, OWASP into enforceable predicates. These
become (a) system-prompt doctrine and (b) a code guardrail layer wrapping every tool call.

1. **Scope is the prime directive.** Act only against a verified in-scope target on an allow-list
   (IPs/hosts/URLs). No scope expansion by inference — a discovered subdomain/bucket/linked host is
   out-of-scope unless explicitly listed. Re-check scope on every outbound request (deny-by-default).
2. **Proof of Concept, not Proof of Exploitation.** Demonstrate the vuln exists and is impactful,
   then stop. Minimal-impact demonstration; access the least data needed.
3. **Never exfiltrate real user data.** On contact with real PII/PHI/credentials/card data: **halt
   and report** — do not read further, screenshot, download, or store it. Prove data-exposure bugs
   with a count / schema name / one redacted or synthetic cell, never a bulk dump.
4. **Use benign canary markers, never real data,** to prove write/injection/XSS/SSRF (UUIDs,
   `alert(document.domain)`, a controlled callback) — not live records.
5. **No damage:** no DoS/volumetric/resource-exhaustion, no data modification/deletion, no
   persistence/backdoors/new accounts, no lateral movement beyond the authorized asset, no social
   engineering/phishing. Throttle by default (~1 req/s unless the target is our own box).
6. **Clean up** every artifact (uploaded payloads, planted markers, test accounts); keep a cleanup log.
7. **Coordinated disclosure + chain-of-custody:** default to non-disclosure, report through the
   sanctioned channel, never publish secrets, store evidence access-controlled with timestamps and
   exact request/response, retain only what proves the bug.

(For a self-owned Juice Shop these are mostly trivially satisfied, but we encode them now so the
same agent is safe the day a target is *not* our own box.)

---

## 4. Agent design — two graphs

### A. `langgraph:red-accumulator` (scheduled, cheap)
A small `createReactAgent` (or even a plain node) that:
1. Reads configured target sources (v0: our Juice Shop instance's `/api/Challenges`).
2. Upserts rows into `red_challenges` (name, category, difficulty, source, target URL, solved-state).
3. Emits a summary.

Wiring: one `schedules` row (`cron`, `graphId: langgraph:red-accumulator`, durable `execution_grant`)
→ atomically created Temporal Schedule → each tick starts `GraphRunWorkflow`. **No new scheduling or
workflow code** (this node has no Temporal worker of its own; the shared operator worker runs it).

### B. `langgraph:red-solver` (per-target, the core)
A hand-wired `StateGraph` modeled on `graphs/research/graph.ts`, assigned exactly one target
(a `red_challenges` row / `red_targets` entry). Nodes:

```
__start__
  → scope_guard      (load target into an allow-list; refuse if target not authorized)
  → recon            (enumerate surface with bounded tools; whitebox source read if provided)
  → plan             (form a ranked, falsifiable exploit hypothesis — reuse edo_hypothesize)
  → act  ⇄ act_tools (ReAct-style loop: run bounded attack tools, observe; MAX_ACT_ITERATIONS)
  → verify           (confirm the REAL flag / solved-state on the live target; fakes rejected)
       ├── not solved & budget left → back to plan
       └── solved OR budget exhausted
  → report           (chain-of-custody writeup: hypothesis, steps, evidence, flag, cleanup log)
  → __end__
```

Key properties, all patterned on `research/graph.ts`:
- **Hard iteration + wall-clock budgets** per node (`MAX_RECON_*`, `MAX_ACT_ITERATIONS`,
  `MAX_REPLANS`) so a run can't spin forever.
- **Scope guard is a graph node AND a tool-policy wrapper** — belt and suspenders.
- **Progress persisted** to `.context/<challenge>-progress.md` (matches the proven human workflow in
  `ctf-autonomy-derek` memory) + a `red_attempts` row, so a human can watch and a crash leaves a trail.
- **Verify-on-live-target** is non-negotiable: bundled source/Docker flags are fakes; confirm the
  real flag against the running box (lesson from `ctf-file-upload-rce`).

---

## 5. New data model (small)

Two new tables in a `red` schema file (`packages/db-schema/src/red.ts`), RLS-enabled like the rest:

- **`red_challenges`** — accumulated catalog: `id, source, external_id, name, category, difficulty,
  target_url, in_scope (bool), solved_state, metadata jsonb, first_seen_at, last_seen_at`.
- **`red_attempts`** — one per solver run: `id, challenge_id (fk), graph_run_id (fk graph_runs.run_id),
  status (enum), hypothesis, flag, evidence_ref, cleanup_log, started_at, completed_at`.

Findings/evidence can start as jsonb on `red_attempts` and graduate to a `red_findings` table later.
Run status/retry/trace is already covered by `graph_runs` — we only add domain tables. **No-migration
alternative:** lean on the existing Doltgres `knowledge` store + `core__knowledge_write/read/search`
tools to persist challenges/findings, trading schema rigor for zero migration in v0.

---

## 6. Tooling — closing the capability gap

The agent needs to actually touch a target. Recommended Pareto path: **a single sandboxed exec MCP
server**, not a pile of native tools.

**DECISION (spiked): reuse the existing sandbox substrate — do NOT build a new sandbox.**
`app/src/ports/sandbox-runner.port.ts` + `app/src/adapters/server/sandbox/sandbox-runner.adapter.ts`
(dockerode) already give us exactly what an attack-exec tool needs:
- One-shot ephemeral containers, workspace mount, `maxRuntime` timeout + `maxOutputBytes` cap, pids limit.
- `NETWORK_DEFAULT_DENY` (`NetworkMode: 'none'`), with a `networkMode: 'internal'` mode that attaches
  the container to a **named Docker network created `internal: true`** (P0.5a). Secrets stay host-only.
- A `sandbox:` graph-provider namespace + `sandbox-agent-catalog.provider.ts` already wired.

**The CTF scope guard is therefore structural, enforced by Docker — not just by prompt/policy:**
stand the target (self-hosted Juice Shop) on a dedicated `internal: true` Docker network; run the
agent's exec sandbox in `networkMode: 'internal'` on that same network. The sandbox can reach **only
the target** and has **no external egress at all** — a scope violation is impossible at the network
layer. This collapses most of §7's egress-guard work into a Docker network boundary.

**Build (small):** a `core__sandbox_exec`-style attack tool (BoundTool) that wraps `SandboxRunnerPort.runOnce`
with a target-scoped `networkMode: 'internal'`, plus a Kali-lite image with curl/nmap/common CTF CLI.
We still add an app-level PII/secret tripwire on tool output (§7). We do **not** build container
isolation, timeouts, output caps, or egress control — all inherited.

**Fallback only if the sandbox can't be driven from a tool: a "red-ops" MCP server** (reuses the MCP path; Playwright proves it):
- Runs in an **isolated sandbox container** on a network that can reach *only* the target
  (egress-allowlisted), so a scope violation is impossible at the network layer.
- Exposes a few bounded tools: `http_request` (method/url/headers/body), `shell` (curl, nmap,
  common CTF CLI — in the sandbox only), `fs_read`/`fs_write` to a scratch workspace, `fetch_flag`.
- Register in `config/mcp.servers.json` + `mcpServerIds` on the catalog entry (like `browser`/
  `frontend-tester`). Keeps shell **out of the main Next.js process** and gives us a natural
  egress/scope chokepoint.
- For web-only challenges, **Playwright MCP already works today** and can drive `http://<target>`.

**Alternative (more work, less isolation):** native `core__http_request` / `core__shell_exec`
`BoundTool`s. Rejected for v0 because shell in-process is dangerous and we'd have to build the
sandbox + egress control from scratch anyway.

Either way we must add, around attack tools (currently **absent** — `budgets` fields exist but are
unenforced, no rate limiter, no egress guard):
- **Scope/egress allowlist** (deny any host not == the assigned target).
- **PII/secret tripwire** on tool *outputs* (halt + flag on PII/credential patterns).
- **Rate limiter** + per-tool timeout + result-size cap (wire the stubbed `ToolPolicy.budgets`).

---

## 7. Guardrails — ethics enforced in code, not just prose

The doctrine in §3 maps to three enforcement points, all at the existing tool chokepoint
(`tool-runner.ts` / the LangChain wrapper):

1. **Pre-call scope guard:** reject any attack-tool call whose destination ≠ the run's authorized
   target (scope loaded into ALS/`configurable` at run start). Deny-by-default.
2. **Post-call PII tripwire + redaction:** scan tool output for PII/secret patterns; on hit, return
   a "halt — real data contacted" signal that routes the graph to `report` and stops. Mandatory
   `redact()` already exists; extend it.
3. **Budget enforcement:** implement the already-declared `ToolPolicy.budgets`
   (`maxRuntimeMs`, `maxResultBytes`) + a rate limiter — currently stubs.

---

## 8. Pareto MVP scope

**v0 (the Pareto cut) — one graph does it end to end against our own Juice Shop:**
- [ ] `red` schema: `red_challenges`, `red_attempts`.
- [ ] `red-accumulator` graph + a `schedules` row populating `red_challenges` from `/api/Challenges`.
- [ ] `red-solver` `StateGraph` (recon→plan→act→verify→report) with hard budgets, modeled on `research/`.
- [ ] `red-ops` MCP sandbox server (http_request + shell + scratch fs), egress-allowlisted to target.
- [ ] Scope guard + PII tripwire + budget enforcement at the tool chokepoint.
- [ ] Ethics doctrine as the solver system prompt.
- [ ] Proof: agent autonomously solves ≥1 Juice Shop challenge and the box reports it solved.

**v1 (deferred, high value):**
- Durable checkpoint/resume (add a `PostgresSaver`; this is net-new — none exists today).
- Multi-source accumulation (PortSwigger Academy, VulnHub lab) + a target scheduler that assigns
  solver runs to unsolved challenges.
- `red_findings` table + structured disclosure report artifact.

**v2 (later):**
- Sub-agent parallelism (supervisor spawning specialist solvers — reuse the `research` supervisor
  template).
- Non-self-owned targets with a formal authorization record + the full CVD disclosure path.
- HTB/Root-Me integration pending ToS review.

---

## 9. Build-vs-reuse summary

| Need | Reuse | Build |
|---|---|---|
| Register/run a graph, billing, telemetry, streaming | ✅ entire spine | — |
| Schedule the accumulator | ✅ `schedules`+Temporal+run ledger | 1 schedule row |
| Per-target run record | ✅ `graph_runs` | `red_challenges`, `red_attempts` tables |
| Controlled recon→exploit→verify loop | ✅ `research/graph.ts` as template | new `red-solver` StateGraph |
| Attack capability (http/shell/fs) | ✅ `SandboxRunnerPort` — isolation, timeout, output caps, workspace | thin `sandbox_exec` attack tool + Kali-lite image |
| Scope / egress containment | ✅ `networkMode:'internal'` on a target-only Docker network (Docker-enforced) | wire target + sandbox onto one `internal:true` network |
| Safety (PII/budgets) | ✅ deny-by-default policy + `redact()` + `maxRuntime`/`maxOutputBytes` | app-level PII/secret tripwire on tool output |
| Durable resume | ❌ nothing exists | defer to v1 (`PostgresSaver`) |

---

## 10. Risks & open questions

- **Durability vs. MVP speed:** a long solve in a single `invoke()` loses work on crash. v0 accepts
  this (persist progress to `.context` + `red_attempts`); v1 adds a checkpointer. Confirm acceptable.
- **Sandbox provenance:** where does the `red-ops` container run (local docker vs. k8s job)? Needs an
  infra decision; a local docker sandbox is fine for v0 dev proof.
- **Model choice for offensive reasoning:** model is resolved from `configurable.model`; pick a
  capable model (the memory shows Claude solved these well) — no hardcoding.
- **Flag verification contract:** standardize "real flag on live target" verification per source
  (Juice Shop solved-state API vs. `HTB{...}` regex vs. a flag file).
- **ToS re-read before any non-self-owned target.** Hard-gate: v0 is self-owned only.
