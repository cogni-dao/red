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
