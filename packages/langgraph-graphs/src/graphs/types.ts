// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/graphs/types`
 * Purpose: Shared graph type definitions for all LangGraph agents.
 * Scope: Type firewall for LangGraph generics. Does NOT implement graph logic.
 * Invariants:
 *   - SINGLE_INVOKABLE_INTERFACE: All graphs implement InvokableGraph<I,O>
 *   - LANGCHAIN_ALIGNED: Uses RunnableConfig/RunnableInterface from @langchain/core
 * Side-effects: none
 * Links: LANGGRAPH_AI.md, AGENT_DEVELOPMENT_GUIDE.md
 * @public
 */

export type {
  CreateReactAgentGraphOptions,
  GraphInvokeOptions,
  InvokableGraph,
  MessageGraphInput,
  MessageGraphOutput,
} from "@cogni/shared-langgraph-graphs/graphs";
