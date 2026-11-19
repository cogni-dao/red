// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/execution-scope`
 * Purpose: AsyncLocalStorage-based execution scope for billing, abort signal, and usage source.
 * Scope: Provides per-run billing context, abort signal, and usage source (SourceSystem) to static inner providers via Node-native ALS. Does not carry shared contract types — billing is app-local.
 * Invariants:
 *   - ALS_NOT_SHARED: ExecutionScope is app-local, never exported to @cogni/graph-execution-core
 *   - BILLING_SET_BY_LAUNCHER: runInScope is called by the launcher (chat, schedule, webhook)
 *   - ABORT_CHAT_ONLY: abortSignal is temporary tech debt for browser disconnect, not durable cancellation
 *   - ACTING_PRINCIPAL_FOR_WRITES (task.0175): a write records `actingPrincipal(scope)` as its actor; `runId` with `runKind` (host-set) is recorded as the run. This node has one run identity (`actorUserId`), so there is no separate requester. An unknown run never blocks a write: it omits the `Run:` line.
 * Side-effects: none (ALS is process-scoped, no I/O)
 * Links: https://github.com/cogni-dao/cogni/blob/2321821e61dd12aa0cf75d235bd668ff65739109/docs/spec/unified-graph-launch.md
 * @public
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { SourceSystem } from "@cogni/ai-core";
import type { WriteRunKind } from "@cogni/work-items";
import type { BillingContext, LlmService } from "@/ports";

/**
 * Per-run execution scope set by the launcher, read by static inner providers.
 *
 * Contains only billing + optional abort + resolved LlmService. Tracing flows via OTel.
 * Shared ExecutionContext (actorUserId, sessionId, etc.) flows via runGraph(req, ctx).
 */
export interface ExecutionScope {
  readonly billing: BillingContext;
  /** The run this scope serves: set by the launcher (`runGraphWithScope`). A tool that needs per-run state (the sandbox folder) reads it here; every run write records it as the run (task.0175). */
  readonly runId?: string;
  /** The run record's kind (`graph_runs.run_kind`), host-set when the record names one. Absent when the record is missing or unreadable: the write then carries no `Run:` line. */
  readonly runKind?: WriteRunKind;
  /** Actor who initiated this run. Used by tools that need user-scoped operations (e.g., schedule CRUD). */
  readonly actorUserId?: string;
  /** Chat-only temporary tech debt — browser disconnect, not durable cancellation. */
  readonly abortSignal?: AbortSignal;
  /** Resolved LlmService for this run (from ModelProviderPort.createLlmService). */
  readonly llmService: LlmService;
  /** Billing source system for usage attribution (from ModelProviderPort.usageSource). */
  readonly usageSource: SourceSystem;
}

/**
 * The actor of a write made inside a run: the run's own actor. Fails closed when the scope names none.
 */
export function actingPrincipal(scope: ExecutionScope): string {
  if (!scope.actorUserId) {
    throw new Error("write denied: the run has no acting principal");
  }
  return scope.actorUserId;
}

const executionScopeStorage = new AsyncLocalStorage<ExecutionScope>();

/**
 * Get the current execution scope. Throws if called outside runInScope.
 */
export function getExecutionScope(): ExecutionScope {
  const scope = executionScopeStorage.getStore();
  if (!scope) {
    throw new Error(
      "getExecutionScope() called outside runInScope — billing context not available"
    );
  }
  return scope;
}

/**
 * Run a function within an execution scope.
 * Sets billing + abort for the duration of the call (and all async continuations).
 */
export function runInScope<T>(scope: ExecutionScope, fn: () => T): T {
  return executionScopeStorage.run(scope, fn);
}
