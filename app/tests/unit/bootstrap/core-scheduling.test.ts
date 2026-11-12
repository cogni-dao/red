import { expect, it, vi } from "vitest";
import { createScheduleListImplementation, createScheduleManageImplementation } from "@cogni/ai-tools";
import type { ScheduleCapability, ScheduleInfo } from "@cogni/ai-tools";
import type { ScheduleUserPort } from "@cogni/scheduler-core";
import { runInScope } from "@/adapters/server/ai/execution-scope";
import { createScheduleCapability } from "@/bootstrap/capabilities/schedule";
vi.mock("@/shared/config", () => ({ getNodeId: () => "red-node" }));

it("filters purpose by exact metadata, excluding mentions in coordinating instructions", async () => {
  const rows = [
    { id: "coordinator", input: { _meta: { purpose: "operate" }, messages: [{ role: "user", content: "run node-work-triage" }] } },
    { id: "child", input: { _meta: { purpose: "node-work-triage" } } },
  ] as unknown as ScheduleInfo[];
  const result = await createScheduleListImplementation({ scheduleCapability: { list: async () => rows } as ScheduleCapability }).execute({ purpose: "node-work-triage" });
  expect(result.schedules.map((row) => row.id)).toEqual(["child"]);
});

it("persists flat instructions, stable purpose and the exact current model reference", async () => {
  const stored = { id: "schedule", graphId: "langgraph:work-prioritizer", input: {}, cron: "0 * * * *", timezone: "UTC", enabled: true, nextRunAt: null, lastRunAt: null, createdAt: new Date(), updatedAt: new Date() };
  const createSchedule = vi.fn(async () => stored);
  const capability = createScheduleCapability({
    scheduleManager: { createSchedule } as unknown as ScheduleUserPort,
    getOrCreateBillingAccountId: async () => "payer",
  });
  const modelRef = { providerKey: "codex", modelId: "chosen-model", connectionId: "owned-connection" };
  await runInScope({ billing: { billingAccountId: "payer", virtualKeyId: "key" }, actorUserId: "11111111-1111-4111-8111-111111111111", modelRef, usageSource: "litellm", llmService: {} as never }, async () => {
    await createScheduleManageImplementation({ scheduleCapability: capability }).execute({ action: "create", graphId: "langgraph:work-prioritizer", cron: "0 * * * *", timezone: "UTC", instruction: "Triage open work", purpose: "node-work-triage", input: { modelRef: { providerKey: "platform", modelId: "invented" } } });
  });
  expect(createSchedule).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "payer", expect.objectContaining({ input: {
    modelRef, messages: [{ role: "user", content: "Triage open work" }], _meta: { purpose: "node-work-triage" },
  } }));
});
