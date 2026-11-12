// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/runtime/core/make-server-graph`
 * Purpose: Create compiled graph for langgraph dev server.
 * Scope: Wiring-only helper. Does NOT import LANGGRAPH_CATALOG. Does NOT enforce policy.
 * Invariants:
 *   - HELPERS_DO_NOT_IMPORT_GRAPH_CATALOG: No LANGGRAPH_CATALOG import (type transparency); TOOL_CATALOG allowed
 *   - HELPERS_DO_NOT_ENFORCE_POLICY: Policy is ToolRunner's job
 *   - NO_HIDDEN_DEFAULT_MODEL: Model comes from configurable only (fail-fast at invoke if missing)
 *   - FAIL_FAST_ON_MISSING_TOOLS: Throw if toolIds reference tools not in TOOL_CATALOG
 *   - TYPE_TRANSPARENT_RETURN: Returns ReturnType<TCreateGraph> to preserve concrete types for CLI schema extraction
 * Side-effects: process.env (reads LITELLM_BASE_URL, LITELLM_MASTER_KEY)
 * Links: GRAPH_EXECUTION.md, LANGGRAPH_AI.md
 * @public
 */

import { type CatalogBoundTool, TOOL_CATALOG } from "@cogni/red-ai-tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { initChatModel } from "langchain/chat_models/universal";

import type { CreateReactAgentGraphOptions } from "../../graphs/types";
import { createDevToolExecFn } from "./dev-tool-exec";
import { toLangChainToolsCaptured } from "./langchain-tools";

/**
 * Create a compiled graph for langgraph dev server.
 *
 * This is an async function because it initializes the LLM via initChatModel.
 * Call with top-level await in server.ts.
 *
 * Per TYPE_TRANSPARENT_RETURN: Generic over TCreateGraph and returns
 * ReturnType<TCreateGraph> to preserve concrete graph types for the
 * LangGraph CLI schema extractor.
 *
 * Per HELPERS_DO_NOT_IMPORT_CATALOG: Takes explicit toolIds, no catalog lookup.
 * Per HELPERS_DO_NOT_ENFORCE_POLICY: Tool wiring only; policy is ToolRunner's job.
 *
 * @param opts - Options with name, createGraph factory, and toolIds
 * @returns Compiled graph ready for invoke (concrete type preserved)
 *
 * @example
 * ```typescript
 * // graphs/poet/server.ts
 * export const poet = await makeServerGraph({
 *   name: POET_GRAPH_NAME,
 *   createGraph: createPoetGraph,
 *   toolIds: POET_TOOL_IDS,
 * });
 * ```
 */
export async function makeServerGraph<
  TCreateGraph extends (opts: CreateReactAgentGraphOptions) => unknown,
>(opts: {
  /** Graph name (for error messages) */
  readonly name: string;
  /** Pure graph factory function */
  readonly createGraph: TCreateGraph;
  /** Tool IDs this graph uses (from per-graph tools.ts) */
  readonly toolIds: readonly string[];
  readonly program?: CreateReactAgentGraphOptions["program"];
  readonly sourceContext?: CreateReactAgentGraphOptions["sourceContext"];
  readonly systemPrompt?: string;
}): Promise<ReturnType<TCreateGraph>> {
  const { name, createGraph, toolIds } = opts;

  // Read env for LiteLLM connection
  // biome-ignore lint/style/noProcessEnv: Dev-only helper
  const baseURL = process.env.LITELLM_BASE_URL ?? "http://localhost:4000";
  // biome-ignore lint/style/noProcessEnv: Dev-only helper
  const apiKey = process.env.LITELLM_MASTER_KEY ?? "dev-key";

  // Initialize configurable LLM (model comes from RunnableConfig.configurable.model)
  // Per CONFIGURABLE_USER_SERVER_SET: include "user" for billing correlation
  const llm = await initChatModel(undefined, {
    configurableFields: ["model", "user"],
    modelProvider: "openai",
    configuration: { baseURL },
    apiKey,
  });

  // Resolve bound tools from TOOL_CATALOG
  const boundTools: Readonly<Record<string, CatalogBoundTool>> =
    Object.fromEntries(
      toolIds
        .map((id) => [id, TOOL_CATALOG[id]] as const)
        .filter(
          (entry): entry is [string, CatalogBoundTool] => entry[1] !== undefined
        )
    );

  // Fail fast if tools missing (per FAIL_FAST_ON_MISSING_TOOLS)
  const missingTools = toolIds.filter((id) => !boundTools[id]);
  if (missingTools.length > 0) {
    throw new Error(
      `[makeServerGraph:${name}] Missing tools in TOOL_CATALOG: ${missingTools.join(", ")}. ` +
        `Ensure all tool IDs in toolIds exist in @cogni/ai-tools TOOL_CATALOG.`
    );
  }

  // Create tool execution function for dev server
  const toolContracts = Object.values(boundTools).map((bt) => bt.contract);
  const buildGraph = () => {
    const execute = createDevToolExecFn(boundTools);
    const hooks = (createGraph as import("../../inproc/types").CreateGraphFn).createRunHooks?.({
      ...(opts.program !== undefined && { program: opts.program }),
      ...(opts.sourceContext?.origin !== undefined && { origin: opts.sourceContext.origin }),
    });
    const devToolExecFn: typeof execute = async (name, args, callId) => {
      const result = await execute(name, args, callId);
      hooks?.observeTool?.(name, args, result, callId);
      return result;
    };
    const tools: StructuredToolInterface[] = toLangChainToolsCaptured({ contracts: toolContracts, toolExecFn: devToolExecFn });
  // Create graph using factory - cast preserves concrete return type
  return createGraph({
    llm, tools,
    ...hooks?.graphOptions,
    ...(opts.program !== undefined && { program: opts.program }),
    ...(opts.sourceContext !== undefined && { sourceContext: opts.sourceContext }),
    ...(opts.systemPrompt !== undefined && { systemPrompt: opts.systemPrompt }),
    readToolIds: toolContracts.filter((c) => c.effect === "read_only").map((c) => c.name),
    readSkill: async (id: string) => {
      const result = await devToolExecFn("core__knowledge_read", { id });
      if (!result.ok) { hooks?.onSkillReadFailure?.(); throw new Error("skill_read_unavailable"); }
      const data = result.value as { entries?: { id: string; content: string }[] };
      const content = data.entries?.find((entry) => entry.id === id)?.content;
      if (!content?.trim()) { hooks?.onSkillReadFailure?.(); throw new Error("skill_read_unavailable"); }
      return content;
    },
  }) as ReturnType<TCreateGraph>;
  };
  if (!opts.program) return buildGraph();

  // The dev server keeps exported graphs alive. Each invocation needs fresh program receipts,
  // including calls made through a withConfig binding. Preserve compiled-graph introspection.
  function isolate<T extends object>(factory: () => T): T {
    const target = factory();
    return new Proxy(target, {
      get(instance, property) {
        if (property === "withConfig") return (...args: unknown[]) => isolate(() => {
          const fresh = factory();
          const method: unknown = Reflect.get(fresh, property);
          if (typeof method !== "function") throw new Error("program_method_unavailable");
          return Reflect.apply(method, fresh, args) as T;
        });
        if (["invoke", "stream", "streamEvents", "streamLog"].includes(String(property))) return (...args: unknown[]) => {
          const fresh = factory();
          const method: unknown = Reflect.get(fresh, property);
          if (typeof method !== "function") throw new Error("program_method_unavailable");
          return Reflect.apply(method, fresh, args);
        };
        if (["batch", "batchAsCompleted"].includes(String(property))) return () => { throw new Error("program_batch_not_supported"); };
        const value = Reflect.get(instance, property);
        return typeof value === "function" ? value.bind(instance) : value;
      },
    });
  }
  return isolate(buildGraph as () => object) as ReturnType<TCreateGraph>;
}
