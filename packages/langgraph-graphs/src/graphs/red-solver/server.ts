// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/red-solver/server`
 * Purpose: LangGraph dev server entrypoint for red-solver graph.
 * Scope: Thin entrypoint. Does NOT import catalog (type transparency for LangGraph CLI).
 * Invariants:
 *   - LANGGRAPH_JSON_POINTS_TO_SERVER_ONLY: Referenced by langgraph.json
 *   - HELPERS_DO_NOT_IMPORT_CATALOG: Uses makeServerGraph with explicit toolIds
 *   - NO_CROSSING_THE_STREAMS: Uses initChatModel (via makeServerGraph), never ALS
 * Side-effects: process.env (via makeServerGraph)
 * Links: docs/spec/graph-execution.md
 * @internal
 */

import { makeServerGraph } from "../../runtime/core/make-server-graph";
import { createRedSolverGraph, RED_SOLVER_GRAPH_NAME } from "./graph";
import { RED_SOLVER_TOOL_IDS } from "./tools";

export const redSolver = await makeServerGraph({
  name: RED_SOLVER_GRAPH_NAME,
  createGraph: createRedSolverGraph,
  toolIds: RED_SOLVER_TOOL_IDS,
});
