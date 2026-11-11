// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/work-prioritizer-tools`
 * Purpose: The released work-prioritizer is offered, and can run, every tool it needs (task.0086).
 * Scope: Reads the program's tool ids from LANGGRAPH_CATALOG, the node tool catalog and createToolBindings. No tool executes.
 * Invariants: PROGRAM_TOOLS_ARE_BOUND: each tool id the program lists has a catalog entry and a binding; core__work_item_update needs work_item:transition.
 * Side-effects: none
 * @internal
 */

import { TOOL_CATALOG } from "@cogni/ai-tools";
import { LANGGRAPH_CATALOG } from "@cogni/langgraph-graphs";
import { describe, expect, it } from "vitest";

import { createToolBindings } from "../../../src/bootstrap/ai/tool-bindings";

describe("work-prioritizer tool surface (task.0086)", () => {
  const toolIds = LANGGRAPH_CATALOG["work-prioritizer"]?.toolIds ?? [];

  it("is offered core__work_item_update and core__work_item_read", () => {
    expect(toolIds).toContain("core__work_item_update");
    expect(toolIds).toContain("core__work_item_read");
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

  it("requires the same grant as the transition tool for core__work_item_update", () => {
    const update = TOOL_CATALOG.core__work_item_update;
    expect(update?.contract.requires).toMatchObject({
      scope: "work_item:transition",
    });
    expect(TOOL_CATALOG.core__work_item_transition?.contract.requires).toMatchObject(
      { scope: "work_item:transition" }
    );
  });
});
