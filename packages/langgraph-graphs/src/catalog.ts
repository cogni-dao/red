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
 * Links: https://node-template.cognidao.org/knowledge/graph-execution-invariants
 * @public
 */

import { NODE_LANGGRAPH_CATALOG as SHARED_NODE_CATALOG } from "@cogni/shared-langgraph-graphs";

import {
	createRedSolverGraph,
	RED_SOLVER_GRAPH_NAME,
} from "./graphs/red-solver/graph";
import { RED_SOLVER_TOOL_IDS } from "./graphs/red-solver/tools";
import type { CreateGraphFn } from "./inproc/types";

/**
 * Catalog entry shape.
 *
 * Per TOOL_CATALOG_IS_CANONICAL: graphs reference tools by ID, not by BoundTool.
 * Providers resolve tools from TOOL_CATALOG using these IDs.
 */
interface CatalogEntry {
	readonly displayName: string;
	readonly sharedRuntime?: boolean;
	readonly description: string;
	/** Native tool IDs this graph may use. Providers resolve from TOOL_CATALOG. */
	readonly toolIds: readonly string[];
	/** MCP server names whose tools this graph may use. Empty = no MCP tools. */
	readonly mcpServerIds?: readonly string[];
	readonly graphFactory: CreateGraphFn;
	/** Optional system prompt for operator graphs (catalog-driven, not hardcoded). */
	readonly systemPrompt?: string;
}

/**
 * RED's work-prioritizer: the released entry with its write tools (update, artifact record) removed, so it is read-only.
 *
 * Triage writes are off on red until the program plumbing (program, sourceContext, run hooks) is ported.
 * RED's in-proc runner does not pass `program` to the graph factory, so the released prioritizer would run
 * as a plain ReAct agent holding the full-schema `core__work_item_update` with no triage guard, no
 * five-change cap and no receipt. `core__work_item_read` stays; the update and artifact-record tools are neither offered nor bound.
 */
const SHARED_WORK_PRIORITIZER = SHARED_NODE_CATALOG["work-prioritizer"];
const RED_WORK_PRIORITIZER: CatalogEntry = {
	...SHARED_WORK_PRIORITIZER,
	toolIds: SHARED_WORK_PRIORITIZER.toolIds.filter(
		(id) =>
			id !== "core__work_item_update" &&
			id !== "core__work_item_artifact_record",
	),
	systemPrompt: `${SHARED_WORK_PRIORITIZER.systemPrompt} READ-ONLY ON THIS NODE: triage writes are off, so core__work_item_update and core__work_item_artifact_record are not available. Do not try to change any item. Read as above, then report in your final answer the routes, scores and cancels you would make, one line per item, with the reason for each. Reporting them satisfies the run; ignore the instruction to write.`,
};

/**
 * LangGraph catalog - single source of truth for graph definitions.
 *
 * To add a new graph:
 * 1. Create graph factory in graphs/<name>/graph.ts
 * 2. Add entry here with boundTools and graphFactory
 * 3. Bootstrap automatically picks it up (no changes needed there)
 *
 * Per CATALOG_SINGLE_SOURCE_OF_TRUTH: graphs are defined here, not in bootstrap.
 */
export const LANGGRAPH_CATALOG: Readonly<Record<string, CatalogEntry>> = {
	cogni: { ...SHARED_NODE_CATALOG.cogni, sharedRuntime: true },
	"work-prioritizer": RED_WORK_PRIORITIZER,
	/**
	 * Red Solver graph - authorized ethical red-team solver.
	 * Given ONE target + challenge, runs a scope-bound solve attempt via the
	 * http_request tool and returns an evidence-backed report.
	 */
	[RED_SOLVER_GRAPH_NAME]: {
		displayName: "Red Solver",
		description:
			"Authorized ethical red-team solver — scope-bound HTTP attack loop with evidence-backed reporting",
		toolIds: RED_SOLVER_TOOL_IDS as readonly string[],
		graphFactory: createRedSolverGraph,
	},
} as const;

/**
 * Type helper for catalog entry lookup (short names).
 */
export type LangGraphCatalogKeys = keyof typeof LANGGRAPH_CATALOG;

/**
 * LangGraph provider ID for namespacing.
 */
export const LANGGRAPH_PROVIDER_ID = "langgraph" as const;

/**
 * Fully-qualified graph IDs satisfying GraphId from @cogni/ai-core.
 * Per GRAPH_ID_NAMESPACED: format is ${providerId}:${graphName}
 */
export const LANGGRAPH_GRAPH_IDS = {
	cogni: `${LANGGRAPH_PROVIDER_ID}:cogni`,
	"work-prioritizer": `${LANGGRAPH_PROVIDER_ID}:work-prioritizer`,
	"red-solver": `${LANGGRAPH_PROVIDER_ID}:${RED_SOLVER_GRAPH_NAME}`,
} as const;

/**
 * Union type of all valid LangGraph graph IDs.
 */
export type LangGraphGraphId =
	(typeof LANGGRAPH_GRAPH_IDS)[keyof typeof LANGGRAPH_GRAPH_IDS];

/**
 * Default graph ID.
 */
export const DEFAULT_LANGGRAPH_GRAPH_ID = LANGGRAPH_GRAPH_IDS.cogni;
