// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/bootstrap/work-prioritizer-tools`
 * Purpose: RED's work-prioritizer stays read-only and every tool it is offered is bound (task.0086).
 * Scope: Reads the program's tool ids from LANGGRAPH_CATALOG, the node tool catalog, createToolBindings and the goal-metric tool bindings the container adds. No tool executes.
 * Invariants:
 *   - PRIORITIZER_READ_ONLY: triage writes are off on red until the program plumbing (program, sourceContext, run hooks) is ported, so the program is offered neither core__work_item_update nor core__work_item_transition.
 *   - PROGRAM_TOOLS_ARE_BOUND: each tool id the program lists has a catalog entry and a binding.
 * Side-effects: none
 * @internal
 */

import { TOOL_CATALOG } from "@cogni/ai-tools";
import { LANGGRAPH_CATALOG } from "@cogni/langgraph-graphs";
import { describe, expect, it } from "vitest";

import { createToolBindings } from "../../../src/bootstrap/ai/tool-bindings";
import { createGoalMetricTools } from "../../../src/bootstrap/capabilities/goal-metrics";

describe("work-prioritizer tool surface (task.0086)", () => {
  const toolIds = LANGGRAPH_CATALOG["work-prioritizer"]?.toolIds ?? [];

  it("is read-only: not offered core__work_item_update or core__work_item_transition", () => {
    expect(toolIds.length).toBeGreaterThan(0);
    expect(toolIds).not.toContain("core__work_item_update");
    expect(toolIds).not.toContain("core__work_item_transition");
    expect(toolIds).toContain("core__work_item_read");
    expect(toolIds).toContain("core__work_item_query");
  });

  it("is told it is read-only", () => {
    expect(LANGGRAPH_CATALOG["work-prioritizer"]?.systemPrompt).toContain(
      "READ-ONLY ON THIS NODE"
    );
  });

  it("has every offered tool in the node tool catalog and bound to an implementation", () => {
    // The container binds the goal-metric tools (core__goal_progress, core__metric_*) beside these.
    const metricBindings = createGoalMetricTools({
      metrics: () => undefined,
      goalProgress: async () => {
        throw new Error("not read");
      },
    }).bindings;
    const bindings = {
      ...createToolBindings({
        knowledgeCapability: {} as never,
        edoCapability: {} as never,
        metricsCapability: {} as never,
        webSearchCapability: {} as never,
        repoCapability: {} as never,
        scheduleCapability: {} as never,
        vcsCapability: {} as never,
        workItemCapability: {} as never,
      }),
      ...metricBindings,
    };
    for (const id of toolIds) {
      expect(TOOL_CATALOG[id], `${id} in TOOL_CATALOG`).toBeDefined();
      expect(bindings[id], `${id} bound`).toBeDefined();
    }
  });

  it("does not put the full-schema update tool in the node tool catalog at all", () => {
    expect(TOOL_CATALOG.core__work_item_update).toBeUndefined();
  });
});
