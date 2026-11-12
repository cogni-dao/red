import { describe, expect, it, vi } from "vitest";
import type { CreateGraphFn } from "../../src/inproc/types";
vi.mock("langchain/chat_models/universal", () => ({ initChatModel: vi.fn(async () => ({})) }));
import { makeServerGraph } from "../../src/runtime/core/make-server-graph";

it("creates independent program receipts for repeated and concurrent dev invocations", async () => {
  const createGraph: CreateGraphFn = Object.assign(
    (opts: Parameters<CreateGraphFn>[0]) => ({
      invoke: async () => {
        const state = opts.programState as { reads: number };
        state.reads += 1;
        await Promise.resolve();
        return { messages: [], structuredResponse: { reads: state.reads } };
      },
    }),
    { createRunHooks: () => ({ graphOptions: { programState: { reads: 0 } } }) }
  );
  const graph = await makeServerGraph({ name: "isolated", createGraph, toolIds: [], program: "work-review" });
  const results = await Promise.all([graph.invoke({ messages: [] }), graph.invoke({ messages: [] })]);
  expect(results.map((r) => r.structuredResponse)).toEqual([{ reads: 1 }, { reads: 1 }]);
  expect((await graph.invoke({ messages: [] })).structuredResponse).toEqual({ reads: 1 });
});
