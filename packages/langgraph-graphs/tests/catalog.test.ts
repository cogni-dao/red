import { CORE_TOOL_BUNDLE } from "@cogni/red-ai-tools";
import { describe, expect, it } from "vitest";
import { NODE_LANGGRAPH_CATALOG, NODE_LANGGRAPH_GRAPH_IDS } from "@cogni/shared-langgraph-graphs";
import { LANGGRAPH_CATALOG, LANGGRAPH_GRAPH_IDS, DEFAULT_LANGGRAPH_GRAPH_ID } from "../src/catalog";

describe("Red catalog composition", () => {
  it("contains exactly the published node core plus Red Solver", () => {
    expect(Object.keys(LANGGRAPH_CATALOG).sort()).toEqual([...Object.keys(NODE_LANGGRAPH_CATALOG), "red-solver"].sort());
    for (const [name, entry] of Object.entries(NODE_LANGGRAPH_CATALOG)) {
      expect(LANGGRAPH_CATALOG[name]).toBe(entry);
      expect(LANGGRAPH_GRAPH_IDS[name as keyof typeof NODE_LANGGRAPH_GRAPH_IDS]).toBe(NODE_LANGGRAPH_GRAPH_IDS[name as keyof typeof NODE_LANGGRAPH_GRAPH_IDS]);
    }
    expect(Object.values(LANGGRAPH_GRAPH_IDS)).toContain(DEFAULT_LANGGRAPH_GRAPH_ID);
  });
  it("has contracts for every advertised tool", () => {
    const ids = new Set(CORE_TOOL_BUNDLE.map((tool) => tool.contract.name));
    for (const entry of Object.values(LANGGRAPH_CATALOG)) for (const id of entry.toolIds) expect(ids.has(id), id).toBe(true);
  });
  it("keeps Red's shell and HTTP tools and excludes operator lifecycle graphs", () => {
    expect(LANGGRAPH_CATALOG["red-solver"]?.toolIds).toEqual(["core__http_request", "core__sandbox_exec"]);
    for (const name of ["operating-review", "pr-manager", "git-reviewer"]) expect(LANGGRAPH_CATALOG[name]).toBeUndefined();
  });
});
