import { expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";

vi.mock("../../src/runtime/core/make-server-graph", () => ({
  makeServerGraph: vi.fn(async () => ({ invocationState: { reads: 0 } })),
}));

it("exports native per-run factories rather than graphs with shared program state", async () => {
  vi.stubEnv("COGNI_REPO_PATH", fileURLToPath(new URL("../../../../", import.meta.url)));
  try {
    const { cogni, workPrioritizer } = await import("../../src/server");
    for (const factory of [cogni, workPrioritizer]) {
      expect(typeof factory).toBe("function");
      const [first, second] = await Promise.all([factory(), factory()]);
      expect(first).not.toBe(second);
    }
  } finally { vi.unstubAllEnvs(); }
});

it("leaves server-injected persistence on the graph that actually executes", async () => {
  // Native getGraph() injects persistence after calling the exported factory.
  // Mock the helper with a real compiled graph so the entrypoint cannot hide it behind another instance.
  const { Annotation, MessagesAnnotation, MemorySaver, StateGraph, START, END } = await import("@langchain/langgraph");
  const { makeServerGraph } = await import("../../src/runtime/core/make-server-graph");
  vi.mocked(makeServerGraph).mockImplementation(async () => new StateGraph(Annotation.Root({
    ...MessagesAnnotation.spec,
    turns: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  })).addNode("count", async () => ({ turns: 1 })).addEdge(START, "count").addEdge("count", END).compile() as never);
  vi.stubEnv("COGNI_REPO_PATH", fileURLToPath(new URL("../../../../", import.meta.url)));
  try {
    const { workPrioritizer } = await import("../../src/server");
    const saver = new MemorySaver();
    const config = { configurable: { thread_id: "same-thread" } };
    const counts = [];
    for (let turn = 0; turn < 2; turn++) {
      const graph = await workPrioritizer() as unknown as { checkpointer: typeof saver; invoke: (input: unknown, config: unknown) => Promise<{ turns: number }> };
      graph.checkpointer = saver;
      counts.push((await graph.invoke({ messages: [] }, config)).turns);
    }
    expect(counts).toEqual([1, 2]);
  } finally { vi.unstubAllEnvs(); }
});
