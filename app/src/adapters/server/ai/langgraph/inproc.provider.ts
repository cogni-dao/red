// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/langgraph/inproc.provider`
 * Purpose: Red's adapter over the shared in-process LangGraph provider (`@cogni-dao/langgraph-graphs/inproc`, through `@cogni/langgraph-graphs`).
 * Scope: Binds Red's ports (billed completion adapter, execution scope, logger, trace id, model allow-list) to the package provider, and composes the tool source per request. Holds no guard, audience, denial or catalog logic; a test fails if it grows any.
 * Invariants:
 *   - NO_LOCAL_PROVIDER_LOGIC: the tool guard, principal lock, audience filter, terminal denial, MCP resolution and run runner live in the package; this file only wires
 *   - GRAPH_ID_NAMESPACED: graphId format is "langgraph:${graphName}"
 *   - NO_LANGCHAIN_IN_SRC: no @langchain imports
 *   - PER_REQUEST_COMPOSITION: the provider is cheap to build and never caches its tool source, so a per-run tool composition (`composeTools`) builds one provider per run
 * Side-effects: none at import
 * Links: https://node-template.cognidao.org/knowledge/inproc-provider-package-design
 * @internal
 */

import type { ToolSourcePort } from "@cogni/ai-core";
import type { CatalogBoundTool } from "@cogni/ai-tools";
import {
	type AgentAuthorityPort,
	type CodingCallerPolicy,
	type CompletionUnitPort,
	createLangGraphInProcProvider,
	LANGGRAPH_CATALOG,
	type LangGraphCatalog,
	type Persistence,
	type ProviderLogger,
	type RunScopePort,
	type SourceContext,
} from "@cogni/langgraph-graphs";
import { trace } from "@opentelemetry/api";
import {
	getExecutionScope,
	runInScope,
} from "@/adapters/server/ai/execution-scope";
import type {
	ExecutionContext,
	GraphExecutorPort,
	GraphRunRequest,
	GraphRunResult,
	LlmToolDefinition,
} from "@/ports";
import { isModelAllowed } from "@/shared/ai/model-catalog.server";
import { makeLogger } from "@/shared/observability";

export const LANGGRAPH_PROVIDER_ID = "langgraph" as const;

/** Red's billed completion adapter (`InProcCompletionUnitAdapter`), seen as the package port. */
export type CompletionUnitAdapter = CompletionUnitPort<LlmToolDefinition>;

/** The tool source and tool contracts one run sees. */
export interface RunTools {
	readonly tools: ToolSourcePort;
	readonly toolBundle: readonly CatalogBoundTool[];
}

/** What Red injects. Everything the provider needs from Red arrives here. */
export interface RedProviderWiring {
	readonly completion: CompletionUnitAdapter;
	readonly tools: ToolSourcePort;
	readonly toolBundle: readonly CatalogBoundTool[];
	readonly mcpTools?: () => Promise<ToolSourcePort | null>;
	readonly authority?: AgentAuthorityPort;
	readonly sourceContext?: (required: boolean) => Promise<SourceContext>;
	readonly persistence?: () => Promise<Persistence>;
	readonly coding?: CodingCallerPolicy;
	/** Red's composed catalog (`LANGGRAPH_CATALOG`). A test passes its own. */
	readonly catalog?: LangGraphCatalog;
	/** The tool source and contracts for this run. Absent: `tools` and `toolBundle` as given. */
	readonly composeTools?: (req: GraphRunRequest) => RunTools;
	readonly log?: ProviderLogger;
}

/** Red's run scope (`ExecutionScope`) seen as the package's `RunScopePort`. The launcher sets `actorUserId`; that caller is the run's subject. */
const redRunScope: RunScopePort = {
	current() {
		const scope = getExecutionScope();
		return {
			subjectUserId: scope.subjectUserId ?? scope.actorUserId,
			accountId: scope.billing.billingAccountId,
			abortSignal: scope.abortSignal,
			runAs: (identity, fn) =>
				runInScope(
					{
						...scope,
						runId: identity.runId,
						...(identity.principalId
							? { principalId: identity.principalId }
							: {}),
						...(identity.subjectUserId
							? { subjectUserId: identity.subjectUserId }
							: {}),
					},
					fn,
				),
		};
	},
};

export class LangGraphInProcProvider implements GraphExecutorPort {
	readonly providerId = LANGGRAPH_PROVIDER_ID;

	constructor(private readonly wiring: RedProviderWiring) {}

	runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult {
		const w = this.wiring;
		const { tools, toolBundle } = w.composeTools?.(req) ?? w;
		return createLangGraphInProcProvider<LlmToolDefinition>({
			catalog: w.catalog ?? LANGGRAPH_CATALOG,
			completion: w.completion,
			tools,
			toolBundle,
			scope: redRunScope,
			log: w.log ?? makeLogger({ component: "LangGraphInProcProvider" }),
			isChildModelAllowed: isModelAllowed,
			traceId: () => trace.getActiveSpan()?.spanContext().traceId,
			...(w.mcpTools && { mcpTools: w.mcpTools }),
			...(w.sourceContext && { sourceContext: w.sourceContext }),
			...(w.persistence && { persistence: w.persistence }),
			...(w.authority && { authority: w.authority }),
			...(w.coding && { coding: w.coding }),
		}).runGraph(req, ctx);
	}
}
