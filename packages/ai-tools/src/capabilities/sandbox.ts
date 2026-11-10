// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/capabilities/sandbox`
 * Purpose: Sandbox shell-exec capability interface for AI tool execution.
 * Scope: Defines SandboxExecCapability for running one bounded shell command. Does NOT implement transport.
 * Invariants:
 *   - NO_SECRETS_IN_CONTEXT: capability resolves the execd origin + token, never through tool params.
 *   - BOUNDED_RESULT: the implementation caps stdout/stderr and enforces a command timeout.
 *   - AUTH_VIA_CAPABILITY_INTERFACE: the model never sees the sandbox URL or token.
 * Side-effects: none (interface only)
 * Links: src/adapters/server/sandbox-workspace/, services/sandbox/, work/items/story.0002
 * @public
 */

/** One bounded shell command for the node's remote sandbox. */
export interface SandboxExecParams {
  /** Shell command line executed inside the sandbox workspace. */
  readonly command: string;
  /** Command timeout in milliseconds; the implementation clamps to its own bounds. */
  readonly timeoutMs?: number;
}

/** Bounded result of one sandbox command. */
export interface SandboxExecResult {
  /** 0 on success; the process exit status on failure; -1 when execd reports a non-numeric error. */
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** True when stdout/stderr were truncated to the per-stream cap. */
  readonly truncated: boolean;
  /** execd error name (e.g. `CommandExecError`) when the command failed, else null. */
  readonly errorName: string | null;
}

/**
 * Capability for executing a single bounded shell command in this node's remote
 * sandbox. Identity, origin, and token are injected at construction; they are
 * never model arguments.
 */
export interface SandboxExecCapability {
  exec(params: SandboxExecParams): Promise<SandboxExecResult>;
}
