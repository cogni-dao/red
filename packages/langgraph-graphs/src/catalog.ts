// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/catalog`
 * Purpose: Single source of truth for LangGraph graph definitions.
 * Scope: Exports LANGGRAPH_CATALOG with all available graphs. Does NOT import from src/.
 * Invariants:
 *   - CATALOG_SINGLE_SOURCE_OF_TRUTH: Graph definitions live here, not in bootstrap
 *   - PACKAGES_NO_SRC_IMPORTS: No imports from src/**
 *   - Adding a graph = add entry here, not touch bootstrap
 * Side-effects: none
 * Links: GRAPH_EXECUTION.md, LANGGRAPH_AI.md
 * @public
 */

import {
  DEFAULT_LANGGRAPH_GRAPH_ID,
  NODE_LANGGRAPH_CATALOG as SHARED_NODE_CATALOG,
  NODE_LANGGRAPH_GRAPH_IDS,
  type CatalogEntry,
} from "@cogni/shared-langgraph-graphs";

import { createRedSolverGraph, RED_SOLVER_GRAPH_NAME } from "./graphs/red-solver/graph";
import { RED_SOLVER_TOOL_IDS } from "./graphs/red-solver/tools";

// The published node catalog owns every shared graph, including its program and report.
export const LANGGRAPH_CATALOG: Readonly<Record<string, CatalogEntry>> = {
  ...SHARED_NODE_CATALOG,
  [RED_SOLVER_GRAPH_NAME]: {
    displayName: "Red Solver",
    description: "Authorized ethical red-team solver with scoped HTTP and sandbox shell tools",
    toolIds: RED_SOLVER_TOOL_IDS,
    graphFactory: createRedSolverGraph,
  },
} as const;

export type LangGraphCatalogKeys = keyof typeof LANGGRAPH_CATALOG;
export const LANGGRAPH_PROVIDER_ID = "langgraph" as const;
export const LANGGRAPH_GRAPH_IDS = {
  ...NODE_LANGGRAPH_GRAPH_IDS,
  [RED_SOLVER_GRAPH_NAME]: `${LANGGRAPH_PROVIDER_ID}:${RED_SOLVER_GRAPH_NAME}`,
} as const;
export type LangGraphGraphId = (typeof LANGGRAPH_GRAPH_IDS)[keyof typeof LANGGRAPH_GRAPH_IDS];
export { DEFAULT_LANGGRAPH_GRAPH_ID };
