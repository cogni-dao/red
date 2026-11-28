// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs`
 * Purpose: Barrel export for LangGraph graph definitions and runtime utilities.
 * Scope: Re-exports public types. All @langchain/* code lives here (per NO_LANGCHAIN_IN_SRC). Does not contain implementation logic.
 * Invariants:
 *   - SINGLE_SOURCE_OF_TRUTH: These are the canonical LangGraph definitions
 *   - NO_LANGCHAIN_IN_SRC: Only this package imports @langchain/*
 *   - PACKAGES_NO_SRC_IMPORTS: Never import from src/
 * Side-effects: none
 * Links: https://node-template.cognidao.org/knowledge/graph-execution-invariants
 * @public
 */

// Re-export catalog (Red's one composed catalog; the published catalog stays behind `createNodeCatalog`)
export {
	DEFAULT_LANGGRAPH_GRAPH_ID,
	LANGGRAPH_CATALOG,
	LANGGRAPH_GRAPH_IDS,
	LANGGRAPH_PROVIDER_ID,
	type LangGraphCatalogKeys,
	type LangGraphGraphId,
} from "./catalog";
// Re-export graph constants and factories
export { RED_SOLVER_GRAPH_NAME } from "./graphs/index";
// The in-process provider, runner and their ports are the published package's: one import path for the node, no copy.
export type {
	AgentAuthorityPort,
	CodingCallerPolicy,
	CompletionUnitFinal,
	CompletionUnitParams,
	CompletionUnitPort,
	CreateGraphFn,
	GraphResult,
	InProcGraphRequest,
	InProcRunnerOptions,
	Persistence,
	ProviderLogger,
	RunScopePort,
	SourceContext,
	ToolExecFn,
	ToolExecResult,
} from "@cogni/shared-langgraph-graphs/inproc";
export {
	createInProcGraphRunner,
	createLangGraphInProcProvider,
	createNodeCatalog,
	INPROC_EVENTS,
	LANGGRAPH_INPROC_PROVIDER_ID,
	requiresInProcess,
	resolveNodeSourceContext,
} from "@cogni/shared-langgraph-graphs/inproc";
export type { LangGraphCatalog } from "@cogni/shared-langgraph-graphs";
// Re-export runtime types (interfaces only, not implementations)
export type { MakeLangChainToolOptions } from "./runtime/index";
export type { McpServerConfig, McpServersConfig } from "./runtime/mcp/index";
// Re-export MCP client utilities + tool source
export {
	loadMcpTools,
	McpToolSource,
	parseMcpConfigFromEnv,
} from "./runtime/mcp/index";
