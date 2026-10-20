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
 * Links: docs/spec/tool-use.md, docs/spec/langgraph-patterns.md
 * @public
 */

import {
  HTTP_REQUEST_NAME, SANDBOX_EXEC_NAME, SANDBOX_READ_FILE_NAME, SANDBOX_WRITE_FILE_NAME,
} from "@cogni/ai-tools";

/**
 * Tool IDs for red-solver graph.
 * Single source of truth - imported by server.ts, cogni-exec.ts, and catalog.ts.
 */
export const RED_SOLVER_TOOL_IDS = [
  HTTP_REQUEST_NAME, SANDBOX_EXEC_NAME, SANDBOX_READ_FILE_NAME, SANDBOX_WRITE_FILE_NAME,
] as const;

/**
 * Type for red-solver tool IDs.
 */
export type RedSolverToolId = (typeof RED_SOLVER_TOOL_IDS)[number];
