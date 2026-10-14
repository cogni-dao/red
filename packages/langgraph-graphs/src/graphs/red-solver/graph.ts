// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/red-solver/graph`
 * Purpose: Authorized ethical red-team solver agent graph factory.
 * Scope: Creates a LangGraph React agent that runs a scope-bound solve attempt against ONE
 *        authorized web target. Does NOT execute graphs or read env.
 * Invariants:
 *   - PURE_GRAPH_FACTORY: no side effects, no env reads, LLM/tools injected
 *   - TYPE_TRANSPARENT_RETURN: No explicit return type annotation to preserve
 *     CompiledStateGraph for LangGraph CLI schema extraction
 *   - GRAPH_OWNS_MESSAGES: embeds its own ethics/operational system prompt
 * Side-effects: none
 * Links: docs/guides/agent-development.md, docs/spec/langgraph-patterns.md
 * @public
 */

import { MessagesAnnotation } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

import type { CreateReactAgentGraphOptions } from "../types";
import { RED_SOLVER_SYSTEM_PROMPT } from "./prompts";

/**
 * Graph name constant for routing.
 */
export const RED_SOLVER_GRAPH_NAME = "red-solver" as const;

/**
 * Create an authorized ethical red-team solver agent graph.
 *
 * Mirrors the operator createReactAgent seam (uses `prompt`, not the deprecated
 * `messageModifier`) but owns its prompt rather than taking it from the catalog —
 * the ethics doctrine is intrinsic to this agent and must never be swapped.
 *
 * NOTE: Return type is intentionally NOT annotated to preserve the concrete
 * CompiledStateGraph type for LangGraph CLI schema extraction.
 *
 * @param opts - Options with LLM and tools
 * @returns Compiled LangGraph ready for invoke()
 */
export function createRedSolverGraph(opts: CreateReactAgentGraphOptions) {
  const { llm, tools } = opts;

  return createReactAgent({
    llm,
    tools: [...tools], // Spread readonly array to mutable for LangGraph
    prompt: RED_SOLVER_SYSTEM_PROMPT,
    stateSchema: MessagesAnnotation,
  });
}
