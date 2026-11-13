// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/red-solver/tools`
 * Purpose: Tool IDs for the red-solver graph (single source of truth).
 * Scope: Exports tool capability metadata. Does NOT enforce policy (that's ToolRunner's job).
 * Invariants:
 *   - SINGLE_SOURCE_OF_TRUTH: This is THE list of tools red-solver can use
 *   - CAPABILITY_NOT_POLICY: These are capabilities, not authorization
 * Side-effects: none
 * Links: https://github.com/cogni-dao/cogni/blob/2321821e61dd12aa0cf75d235bd668ff65739109/docs/spec/tool-use.md, https://node-template.cognidao.org/knowledge/graph-execution-invariants
 * @public
 */

import { HTTP_REQUEST_NAME, SANDBOX_EXEC_NAME } from "@cogni/red-ai-tools";

/**
 * Tool IDs for red-solver graph.
 * Single source of truth - imported by server.ts, cogni-exec.ts, and catalog.ts.
 *
 * - HTTP_REQUEST_NAME: scope-bound web recon/PoC (web-class challenges).
 * - SANDBOX_EXEC_NAME: one bounded shell command in the node sandbox for non-web
 *   work (network recon, scripted tooling, pwn/rev/crypto/forensics). Resolves to
 *   `unavailable` when the sandbox is not configured for the environment (story.0002).
 */
export const RED_SOLVER_TOOL_IDS = [
  HTTP_REQUEST_NAME,
  SANDBOX_EXEC_NAME,
] as const;

/**
 * Type for red-solver tool IDs.
 */
export type RedSolverToolId = (typeof RED_SOLVER_TOOL_IDS)[number];
