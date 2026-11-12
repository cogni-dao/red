import { describe, expect, it, vi } from "vitest";
import { evaluateAiRule } from "@/features/review/gates/ai-rule";

describe("retired Red AI rules", () => {
  it("fails a stale declaration without invoking a removed graph", async () => {
    const runGraph = vi.fn();
    const result = await evaluateAiRule({
      rule: { id: "stale-rule" } as Parameters<typeof evaluateAiRule>[0]["rule"],
      evidence: {} as Parameters<typeof evaluateAiRule>[0]["evidence"],
      executor: { runGraph }, model: "unused",
    });
    expect(result.status).toBe("fail");
    expect(result.summary).toContain("no longer hosts");
    expect(runGraph).not.toHaveBeenCalled();
  });
});


it.each(["missing.yaml", "invalid.yaml"])("rejects %s without loading the retired rule", async (ruleFile) => {
  const { runGates } = await import("@/features/review/gate-orchestrator");
  const loadRule = vi.fn(() => { throw new Error("missing or malformed rule"); });
  const executor = { runGraph: vi.fn() };
  const result = await runGates([{ type: "ai-rule", with: { rule_file: ruleFile } }], {} as never, { executor, model: "unused", loadRule, log: { warn: vi.fn() } as never });
  expect(result.conclusion).toBe("fail");
  expect(loadRule).not.toHaveBeenCalled();
  expect(executor.runGraph).not.toHaveBeenCalled();
});
