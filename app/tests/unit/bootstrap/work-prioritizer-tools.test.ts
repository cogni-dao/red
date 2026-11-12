// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/work-prioritizer-tools`
 * Purpose: RED's work-prioritizer uses the published guarded writer and every tool it is offered is bound (task.0086).
 * Scope: Reads the program's tool ids from LANGGRAPH_CATALOG, the node tool catalog and createToolBindings. No tool executes.
 * Invariants:
 *   - PRIORITIZER_GUARDED: program, sourceContext and the published runner provide triage guards before update dispatch.
 *   - PROGRAM_TOOLS_ARE_BOUND: each tool id the program lists has a catalog entry and a binding.
 * Side-effects: none
 * @internal
 */

import { TOOL_CATALOG } from "@cogni/ai-tools";
import { LANGGRAPH_CATALOG } from "@cogni/langgraph-graphs";
import { describe, expect, it } from "vitest";

import { createToolBindings } from "../../../src/bootstrap/ai/tool-bindings";

describe("work-prioritizer tool surface (task.0086)", () => {
  const toolIds = LANGGRAPH_CATALOG["work-prioritizer"]?.toolIds ?? [];

  it("uses the published guarded work-review program and its one update tool", () => {
    expect(LANGGRAPH_CATALOG["work-prioritizer"]?.program).toBe("work-review");
    expect(toolIds).toContain("core__work_item_update");
    expect(toolIds).not.toContain("core__work_item_transition");
    expect(toolIds).toContain("core__work_item_read");
    expect(toolIds).toContain("core__work_item_query");
    expect(LANGGRAPH_CATALOG["work-prioritizer"]?.graphFactory.createRunHooks).toBeTypeOf("function");
  });

  it("has every offered tool in the node tool catalog and bound to an implementation", () => {
    const bindings = createToolBindings({
      knowledgeCapability: {} as never,
      edoCapability: {} as never,
      metricsCapability: {} as never,
      webSearchCapability: {} as never,
      repoCapability: {} as never,
      scheduleCapability: {} as never,
      vcsCapability: {} as never,
      workItemCapability: {} as never,
    });
    for (const id of toolIds) {
      expect(TOOL_CATALOG[id], `${id} in TOOL_CATALOG`).toBeDefined();
      expect(bindings[id], `${id} bound`).toBeDefined();
    }
  });

  it("provides the published update contract to the guarded runner", () => {
    expect(TOOL_CATALOG.core__work_item_update).toBeDefined();
  });
});
