// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/catalog`
 * Purpose: Red's one composed graph catalog: the published node catalog plus Red's own graph, with one narrowing and one omission.
 * Scope: Composition only, through `createNodeCatalog` (`@cogni-dao/langgraph-graphs/inproc`). Does NOT import from src/.
 * Invariants:
 *   - CATALOG_SINGLE_SOURCE_OF_TRUTH: every consumer (the provider, discovery, the access table, the dev routing) reads this one composed catalog
 *   - EXPLICIT_COMPOSITION: `add`, `narrow` and `omit` are the only ways Red changes the published catalog; no spread decides which entry wins
 *   - PACKAGES_NO_SRC_IMPORTS: No imports from src/**
 * Side-effects: none
 * Links: https://node-template.cognidao.org/knowledge/inproc-provider-package-design, https://node-template.cognidao.org/knowledge/node-plugin-architecture
 * @public
 */

import {
	type CatalogEntry,
	LANGGRAPH_CATALOG as SHARED_CATALOG,
} from "@cogni/shared-langgraph-graphs";
import { createNodeCatalog } from "@cogni/shared-langgraph-graphs/inproc";

import {
	createRedSolverGraph,
	RED_SOLVER_GRAPH_NAME,
} from "./graphs/red-solver/graph";
import {
	RED_SOLVER_PRINCIPAL_SLUG,
	RED_SOLVER_TOOL_IDS,
} from "./graphs/red-solver/tools";

/**
 * Red Solver graph - authorized ethical red-team solver.
 * Given ONE target + challenge, runs a scope-bound solve attempt via the
 * http_request tool and returns an evidence-backed report.
 *
 * It acts as its own seeded principal: the HTTP tool declares `requires` and the guard opens it only for a principal with a
 * live role row. The shell opens only on a claimed run by a coding-audience caller; every other run of the graph runs without it.
 */
const RED_SOLVER: CatalogEntry = {
	displayName: "Red Solver",
	description:
		"Authorized ethical red-team solver — scope-bound HTTP attack loop with evidence-backed reporting",
	principal: RED_SOLVER_PRINCIPAL_SLUG,
	toolIds: RED_SOLVER_TOOL_IDS as readonly string[],
	graphFactory: createRedSolverGraph,
};

/** Red's work-prioritizer reads and reports; it writes nothing (no update, no artifact record). */
const READ_ONLY_NOTE =
	"READ-ONLY ON THIS NODE: triage writes are off, so core__work_item_update and core__work_item_artifact_record are not available. Do not try to change any item. Read as above, then report in your final answer the routes, scores and cancels you would make, one line per item, with the reason for each. Reporting them satisfies the run; ignore the instruction to write.";

/**
 * LangGraph catalog - single source of truth for graph definitions.
 *
 * - `cogni`: the published entry; `createNodeCatalog` rebuilds its prompt and guidance over the composed set.
 * - `work-prioritizer`: the published entry, narrowed to read-only.
 * - `work-closeout`: omitted. It holds `core__work_item_update`, a writer Red does not run.
 * - `red-solver`: Red's own graph.
 */
export const LANGGRAPH_CATALOG = createNodeCatalog(SHARED_CATALOG, {
	add: { [RED_SOLVER_GRAPH_NAME]: RED_SOLVER },
	narrow: {
		"work-prioritizer": {
			removeToolIds: [
				"core__work_item_update",
				"core__work_item_artifact_record",
			],
			appendPrompt: READ_ONLY_NOTE,
		},
	},
	omit: ["work-closeout"],
});

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
