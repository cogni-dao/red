import { AIMessage } from "@langchain/core/messages";
import { CORE_TOOL_BUNDLE } from "@cogni/red-ai-tools";
import { describe, expect, it, vi } from "vitest";
import { LANGGRAPH_CATALOG } from "../../src/catalog";
import { createInProcGraphRunner } from "../../src/inproc/runner";
import type { InProcRunnerOptions } from "../../src/inproc/types";

const sourceContext = { nodeId: "red-node", origin: "https://red.example", mission: { content: "Authorized defensive security", sourceRef: ".cogni/repo-spec.yaml", buildSha: null } };
const request = { runId: "program-test", messages: [{ role: "user" as const, content: "Triage open work" }], configurable: { model: "test-model" } };

describe("published program runtime", () => {
  it.each(["cogni", "work-review"] as const)("forwards trusted %s program and host provenance", async (program) => {
    let observed: Parameters<InProcRunnerOptions["createGraph"]>[0] | undefined;
    const run = createInProcGraphRunner({
      createGraph: (opts) => { observed = opts; return { invoke: async () => ({ messages: [new AIMessage("complete")] }) }; },
      completionFn: vi.fn(), createToolExecFn: () => vi.fn(), toolContracts: [], request, program, sourceContext,
    });
    for await (const _ of run.stream) { /* drain */ }
    expect((await run.final).ok).toBe(true);
    expect(observed?.program).toBe(program);
    expect(observed?.sourceContext).toBe(sourceContext);
  });
  it("rejects a triage mutation without required reads before the host writer", async () => {
    const entry = LANGGRAPH_CATALOG["work-prioritizer"]!;
    const execute = vi.fn(async () => ({ ok: true as const, value: {} }));
    let calls = 0;
    const run = createInProcGraphRunner({
      createGraph: entry.graphFactory,
      program: entry.program,
      sourceContext,
      toolContracts: CORE_TOOL_BUNDLE.filter((tool) => entry.toolIds.includes(tool.contract.name)).map((tool) => tool.contract),
      createToolExecFn: () => execute,
      request,
      completionFn: () => ({ stream: (async function* () {})(), final: Promise.resolve(++calls === 1 ? {
        ok: true, content: "", toolCalls: [{ id: "unsafe-write", type: "function" as const, function: { name: "core__work_item_update", arguments: JSON.stringify({ id: "task.9999", expectedRevision: 0, reason: "unjustified priority change", set: { priority: 0 } }) } }],
      } : { ok: true, content: "Stopped without changing work." }) }),
    });
    for await (const _ of run.stream) { /* drain */ }
    await run.final;
    expect(calls).toBeGreaterThan(0);
    expect(execute.mock.calls.some((args) => (args as unknown[])[0] === "core__work_item_update")).toBe(false);
  });
});
