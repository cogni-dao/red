// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/sandbox-exec`
 * Purpose: Run ONE bounded shell command in the node's remote sandbox for red-team solves.
 * Scope: Schema + capability-injected implementation. Does NOT import LangChain, does NOT read env.
 * Invariants:
 *   - TOOL_ID_NAMESPACED: ID is `core__sandbox_exec` (double-underscore for provider compat)
 *   - EFFECT_TYPED: effect is `external_side_effect` (runs a command outside the app process)
 *   - NO_SECRETS_IN_CONTEXT: sandbox origin + token resolved by the capability, never tool params
 *   - NO_THROW_TO_MODEL: unavailable/transport failures return a structured result, never throw
 *   - BOUNDED_OUTPUT: the capability caps stdout/stderr; this tool surfaces `truncated`
 *   - NO LangChain imports (LangChain wrapping lives in langgraph-graphs)
 * Side-effects: IO (one shell command via the injected SandboxExecCapability)
 * Notes: story.0002 — red-solver shell tool. Candidate-only prototype; caller authorization
 *   (shared OpenFGA/ToolRunner path) is a separate, later vertical. Workspaces are
 *   directory-separated, not a security boundary; external target egress is not guaranteed.
 * Links: https://github.com/cogni-dao/cogni/blob/2321821e61dd12aa0cf75d235bd668ff65739109/docs/spec/tool-use.md, src/adapters/server/sandbox-workspace/, services/sandbox/README.md
 * @public
 */

import { z } from "zod";

import type { SandboxExecCapability } from "../capabilities/sandbox";
import type { BoundTool, ToolContract, ToolImplementation } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const SandboxExecInputSchema = z.object({
  command: z
    .string()
    .min(1)
    .max(16384)
    .describe(
      "Shell command line to run in this node's sandbox workspace (e.g. `nmap -sV host`, " +
        "a python one-liner, or a scripted web tool). Runs to completion; keep it bounded."
    ),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(900000)
    .optional()
    .describe("Command timeout in milliseconds (default 60s, max 15m)."),
});
export type SandboxExecInput = z.infer<typeof SandboxExecInputSchema>;

export const SandboxExecOutputSchema = z.object({
  status: z
    .enum(["ok", "error", "unavailable"])
    .describe(
      "`ok` command ran (see exitCode); `error` transport/protocol failure; " +
        "`unavailable` sandbox not configured for this environment."
    ),
  exitCode: z
    .number()
    .int()
    .describe("Process exit code; 0 on success, -1 on non-numeric execd error."),
  stdout: z.string().describe("Captured standard output (bounded)."),
  stderr: z.string().describe("Captured standard error (bounded)."),
  truncated: z
    .boolean()
    .describe("True when stdout/stderr exceeded the cap and were truncated."),
  message: z
    .string()
    .optional()
    .describe("Diagnostic for a non-ok status; absent on success."),
});
export type SandboxExecOutput = z.infer<typeof SandboxExecOutputSchema>;

/** Redacted output: the command output is already bounded and allowlisted. */
export type SandboxExecRedacted = SandboxExecOutput;

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Namespaced tool ID per TOOL_ID_NAMESPACED invariant.
 * Uses double-underscore separator (provider-compatible: OpenAI allows [a-zA-Z0-9_-]+).
 */
export const SANDBOX_EXEC_NAME = "core__sandbox_exec" as const;

export const sandboxExecContract: ToolContract<
  typeof SANDBOX_EXEC_NAME,
  SandboxExecInput,
  SandboxExecOutput,
  SandboxExecRedacted
> = {
  name: SANDBOX_EXEC_NAME,
  description:
    "Run one shell command in this node's isolated sandbox and get its bounded " +
    "stdout, stderr, and exit code. Use it for non-web work an HTTP tool cannot do: " +
    "network/service recon, scripted tooling, binary/crypto/forensics analysis. " +
    "Each call runs to completion; there is no persistent shell or file state across " +
    "calls yet. Only operate on your authorized target and self-owned fixtures; the " +
    "sandbox workspace is directory-separated, not a security boundary, and egress to " +
    "arbitrary hosts is not guaranteed. Returns status `unavailable` when the sandbox " +
    "is not configured for this environment.",
  effect: "external_side_effect",
  inputSchema: SandboxExecInputSchema,
  outputSchema: SandboxExecOutputSchema,

  redact: (output: SandboxExecOutput): SandboxExecRedacted => output,

  allowlist: [
    "status",
    "exitCode",
    "stdout",
    "stderr",
    "truncated",
    "message",
  ] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

export interface SandboxExecDeps {
  sandboxExecCapability: SandboxExecCapability;
}

/**
 * Create the sandbox-exec implementation with an injected capability.
 * Per capability pattern: the implementation receives the capability at construction,
 * never resolving the origin/token at exec() time.
 */
export function createSandboxExecImplementation(
  deps: SandboxExecDeps
): ToolImplementation<SandboxExecInput, SandboxExecOutput> {
  return {
    execute: async (input: SandboxExecInput): Promise<SandboxExecOutput> => {
      try {
        const result = await deps.sandboxExecCapability.exec({
          command: input.command,
          ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
        });
        return {
          status: "ok",
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          truncated: result.truncated,
          ...(result.errorName !== null && {
            message: `execd reported ${result.errorName}`,
          }),
        };
      } catch (err) {
        // NO_THROW_TO_MODEL: transport/protocol failures are structured, never thrown.
        const reason = err instanceof Error ? err.message : "unknown error";
        return {
          status: "error",
          exitCode: -1,
          stdout: "",
          stderr: "",
          truncated: false,
          message: `[transport-error] Sandbox command failed: ${reason}`,
        };
      }
    },
  };
}

/**
 * Default implementation used when no sandbox capability is configured
 * (e.g. local dev with no SANDBOX_EXECD_TOKEN). Returns a structured
 * `unavailable` result rather than throwing (NO_THROW_TO_MODEL).
 */
export const sandboxExecUnavailableImplementation: ToolImplementation<
  SandboxExecInput,
  SandboxExecOutput
> = {
  execute: async (): Promise<SandboxExecOutput> => ({
    status: "unavailable",
    exitCode: -1,
    stdout: "",
    stderr: "",
    truncated: false,
    message:
      "Sandbox execution is not configured in this environment (no sandbox origin/token).",
  }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Bound Tool (contract + default implementation)
// ─────────────────────────────────────────────────────────────────────────────

export const sandboxExecBoundTool: BoundTool<
  typeof SANDBOX_EXEC_NAME,
  SandboxExecInput,
  SandboxExecOutput,
  SandboxExecRedacted
> = {
  contract: sandboxExecContract,
  implementation: sandboxExecUnavailableImplementation,
};
