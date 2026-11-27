// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { describe, expect, it, vi } from "vitest";
import type { WorkItem, WorkItemsContentPort } from "@cogni/work-items";
import { toWorkItemId, rankScore } from "@cogni/work-items";
import { createWorkItemCapability } from "../../../src/bootstrap/capabilities/work-item";
const scores = {
  goal: { v: 3 },
  time: { v: 2 },
  unblocks: { v: 1 },
  ease: { v: 3 },
  confidence: { v: 2 },
  agent: { v: 3 },
};
const item = {
  id: toWorkItemId("task.0001"),
  type: "task",
  title: "Scored",
  status: "cancelled",
  node: "red",
  actor: "either",
  assignees: [],
  externalRefs: [],
  labels: [],
  specRefs: [],
  revision: 2,
  deployVerified: false,
  createdAt: "2026-10-23",
  updatedAt: "2026-10-23",
  scores,
} as WorkItem;
describe("RED live score writer", () => {
  it("resolves each actor at invocation, reads six fields/rank and fails closed without actor", async () => {
    let actor = "actor-a";
    const patch = vi.fn().mockResolvedValue(item);
    const capability = createWorkItemCapability({
      workItemQuery: {} as never,
      workItemCommand: {} as never,
      backlogReader: {
        get: vi.fn(),
        list: vi.fn().mockResolvedValue({ items: [item] }),
      },
      backlogWriter: {
        store: { patch: patch as WorkItemsContentPort["patch"] },
        attribution: () => {
          if (!actor) throw new Error("write denied: the run has no acting principal");
          return { actor };
        },
      },
    });
    const input = {
      id: item.id,
      expectedRevision: 1,
      reason: "test change",
      set: { scores },
    };
    await capability.patch(input);
    actor = "actor-b";
    const result = await capability.patch(input);
    expect(patch.mock.calls.map((call) => call[1])).toEqual([
      { actor: "actor-a" },
      { actor: "actor-b" },
    ]);
    expect(result.scores).toEqual(scores);
    expect(result.rankScore).toBe(rankScore(scores));
    expect((await capability.query({ ids: [item.id] }))[0]?.scores).toEqual(
      scores
    );
    actor = "";
    await expect(capability.patch(input)).rejects.toThrow(
      "no acting principal"
    );
    expect(patch).toHaveBeenCalledTimes(2);
    actor = "actor-b";
    await expect(
      capability.patch({
        id: item.id,
        reason: "test change",
        set: { priority: 1 },
      })
    ).rejects.toThrow("node admin");
    expect(patch).toHaveBeenCalledTimes(2);
  });
  it("forwards the required reason and the cites to the live store (task.0086)", async () => {
    const patch = vi.fn().mockResolvedValue(item);
    const capability = createWorkItemCapability({
      workItemQuery: {} as never,
      workItemCommand: {} as never,
      backlogWriter: {
        store: { patch: patch as WorkItemsContentPort["patch"] },
        attribution: () => ({ actor: "actor-a" }),
      },
    });
    const cites = [{ id: "change-history-design" }];
    await capability.patch({
      id: item.id,
      reason: "scope follows the design",
      cites,
      set: { rank: 2 },
    });
    expect(patch).toHaveBeenCalledWith(
      {
        id: item.id,
        reason: "scope follows the design",
        cites,
        set: { rank: 2 },
      },
      { actor: "actor-a" }
    );
  });
  it("forwards mixed triage plus foreign content unchanged and preserves the package ownership denial", async () => {
    const denied = Object.assign(
      new Error("Not authorized to mutate work item"),
      { name: "WorkItemAuthorizationError" }
    );
    const patch = vi.fn().mockRejectedValue(denied);
    const capability = createWorkItemCapability({
      workItemQuery: {} as never,
      workItemCommand: {} as never,
      backlogWriter: { store: { patch }, attribution: () => ({ actor: "foreign-creator" }) },
    });
    const input = {
      id: item.id,
      expectedRevision: 1,
      reason: "test change",
      set: { scores, summary: "foreign content" },
    };
    await expect(capability.patch(input)).rejects.toBe(denied);
    expect(patch).toHaveBeenCalledWith(input, { actor: "foreign-creator" });
  });
});


describe("Red canonical write and read compatibility", () => {
  it("preserves cancellation reason, revision, cites and genuine run identity", async () => {
    const patch = vi.fn().mockResolvedValue({ ...item, status: "cancelled" });
    const attribution = { actor: "principal-P", requestedBy: "requester-S", run: { id: "run-R", kind: "system_scheduled" as const } };
    const capability = createWorkItemCapability({
      workItemQuery: {} as never, workItemCommand: {} as never,
      backlogWriter: { store: { patch }, attribution: () => attribution },
    });
    const input = { id: item.id, expectedRevision: 2, reason: "superseded by approved scope", cites: [{ id: "work-gate-enforcement" }], set: { status: "cancelled" as const } };
    expect((await capability.patch(input)).status).toBe("cancelled");
    expect(patch).toHaveBeenCalledExactlyOnceWith(input, attribution);
    for (const code of ["gate_unmet", "gate_facts_unavailable"]) {
      const error = Object.assign(new Error(code), { code });
      patch.mockRejectedValueOnce(error);
      await expect(capability.patch(input)).rejects.toBe(error);
    }
  });
  it("uses the released tool conflict class when the content CAS loses", async () => {
    const { WorkItemPatchConflictError } = await import("@cogni/shared-ai-tools");
    const conflict = Object.assign(new Error("revision_conflict"), { name: "WorkItemRevisionConflictError", expectedRevision: 2, currentRevision: 3 });
    const capability = createWorkItemCapability({
      workItemQuery: {} as never, workItemCommand: {} as never,
      backlogWriter: { store: { patch: vi.fn().mockRejectedValue(conflict) }, attribution: () => ({ actor: "principal-P" }) },
    });
    await expect(capability.patch({ id: item.id, reason: "cancel stale item", expectedRevision: 2, set: { status: "cancelled" } })).rejects.toBeInstanceOf(WorkItemPatchConflictError);
  });
  it("forwards every requested envelope part through the package composer", async () => {
    const artifactRefs = { items: [], nextCursor: null };
    const historyRefs = { items: [], nextCursor: null };
    const artifact = { id: "wia-1" };
    const byId = vi.fn().mockResolvedValue(artifact);
    const capability = createWorkItemCapability({
      workItemQuery: {} as never, workItemCommand: {} as never,
      backlogReader: { get: vi.fn(), list: vi.fn().mockResolvedValue({ items: [item] }) },
      refs: () => ({ artifactRefs: { firstPage: vi.fn().mockResolvedValue(artifactRefs) }, historyRefs: { firstPage: vi.fn().mockResolvedValue(historyRefs) }, artifactById: { get: byId } }),
    });
    const read = await capability.read?.(item.id, { includeArtifacts: true, includeHistory: true, artifactId: "wia-1" });
    expect(read?.artifactRefs).toEqual(artifactRefs);
    expect(read?.historyRefs).toEqual(historyRefs);
    expect(read?.artifact).toEqual(artifact);
    expect(byId).toHaveBeenCalledWith(item.id, "wia-1", expect.any(AbortSignal));
  });
  it("pairs the released EDO contract with execution and preserves decision confidence", async () => {
    const { edoDecideContract, createEdoDecideImplementation } = await import("@cogni/ai-tools");
    const shared = await import("@cogni/shared-ai-tools");
    expect(edoDecideContract).toBe(shared.edoDecideContract);
    const decide = vi.fn().mockResolvedValue({ id: "decision-1", domain: "mission", title: "Choose", sourceType: "agent", confidencePct: 61 });
    const input = edoDecideContract.inputSchema.parse({ id: "decision-1", domain: "mission", title: "Choose", content: "Evidence", derivesFromHypothesisId: "hypothesis-1", sourceType: "agent", confidencePct: 61 });
    await createEdoDecideImplementation({ edoCapability: { decide } as never }).execute(input);
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ confidencePct: 61 }));
  });
});
