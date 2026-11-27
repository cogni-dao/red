// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { describe, expect, it, vi } from "vitest";
import type { WorkItem, WorkItemsContentPort } from "@cogni/work-items";
import { toWorkItemId } from "@cogni/work-items";
import { workItemsHeartbeatOperation, workItemsReleaseOperation } from "@cogni/node-contracts";
import { composeWorkItemContent } from "../../../src/bootstrap/capabilities/work-item-composition";

const item = {
  id: toWorkItemId("task.0001"), type: "task", title: "Current content",
  status: "needs_implement", node: "red", actor: "either", assignees: [],
  externalRefs: [], labels: [], specRefs: [], revision: 8, deployVerified: false,
  createdAt: "2026-10-23", updatedAt: "2026-10-23",
} as WorkItem;
const lease = {
  id: item.id, runId: "run-a", leaseToken: "00000000-0000-4000-a000-000000000001",
  claimedAt: "2026-11-27T16:00:00.000Z", expiresAt: "2026-11-27T16:05:00.000Z",
  lastCommand: "/implement", active: true,
};
function setup() {
  const content = {
    get: vi.fn().mockResolvedValue(item),
    list: vi.fn().mockResolvedValue({ items: [item, { ...item, id: toWorkItemId("task.0002") }], pageInfo: { endCursor: null, hasMore: false } }),
    listSummaries: vi.fn(), history: vi.fn(), historyPage: vi.fn(),
    writerHealth: vi.fn().mockReturnValue({ state: "available" }),
    create: vi.fn(), patch: vi.fn().mockResolvedValue(item), delete: vi.fn(),
  };
  const leases = {
    getMany: vi.fn().mockResolvedValue(new Map([[item.id, lease]])),
    claim: vi.fn().mockResolvedValue(lease), heartbeat: vi.fn().mockResolvedValue(lease),
    release: vi.fn().mockResolvedValue({ ...lease, active: false }),
  };
  return { content, leases, port: composeWorkItemContent(content as WorkItemsContentPort, leases) };
}
describe("Red released content / PostgreSQL lease boundary", () => {
  it("projects one bounded batch per page without exposing any lease token", async () => {
    const { port, leases } = setup();
    const page = await port.list({ limit: 2 });
    expect(leases.getMany).toHaveBeenCalledExactlyOnceWith([item.id, "task.0002"]);
    expect(page.items[0]).toMatchObject({ title: item.title, revision: 8, claimedByRun: lease.runId });
    expect(page.items[1]?.claimedByRun).toBeUndefined();
    expect(JSON.stringify(page)).not.toContain(lease.leaseToken);
    const detail = await port.get(item.id);
    expect(detail?.revision).toBe(8);
    expect(JSON.stringify(detail)).not.toContain(lease.leaseToken);
  });
  it("returns the owner receipt and delegates heartbeat/release without a content write or read", async () => {
    const { port, content, leases } = setup();
    const owner = { id: item.id, runId: lease.runId, principalId: "principal-P", command: "/implement" };
    await expect(port.claim(owner)).resolves.toBe(lease);
    expect(leases.claim).toHaveBeenCalledExactlyOnceWith(owner);
    content.get.mockClear();
    const tokenOwner = { ...owner, leaseToken: lease.leaseToken };
    await port.heartbeat(tokenOwner);
    await port.release(tokenOwner);
    expect(leases.heartbeat).toHaveBeenCalledExactlyOnceWith(tokenOwner);
    expect(leases.release).toHaveBeenCalledExactlyOnceWith(tokenOwner);
    const conflict = Object.assign(new Error("stale token"), { name: "WorkItemLeaseConflictError" });
    leases.heartbeat.mockRejectedValueOnce(conflict);
    await expect(port.heartbeat({ ...tokenOwner, leaseToken: "00000000-0000-4000-a000-000000000002" })).rejects.toBe(conflict);
    expect(content.get).not.toHaveBeenCalled();
    expect(content.patch).not.toHaveBeenCalled();
  });
  it("refuses tokenless renewal/release at the wire boundary", () => {
    const owner = { id: item.id, runId: lease.runId };
    expect(workItemsHeartbeatOperation.input.safeParse(owner).success).toBe(false);
    expect(workItemsReleaseOperation.input.safeParse(owner).success).toBe(false);
    expect(workItemsHeartbeatOperation.input.safeParse({ ...owner, leaseToken: lease.leaseToken }).success).toBe(true);
  });
  it("retains content CAS, history paging, writer health and bounded summary reads", async () => {
    const { port, content, leases } = setup();
    const patch = { id: item.id, expectedRevision: 8, reason: "cancel with retained history", set: { status: "cancelled" as const } };
    const attribution = { actor: "principal-P", requestedBy: "requester-S", run: { id: "run-a", kind: "system_scheduled" as const } };
    await port.patch(patch, attribution);
    expect(content.patch).toHaveBeenCalledExactlyOnceWith(patch, attribution);
    await port.historyPage?.(item.id, { limit: 20 });
    expect(content.historyPage).toHaveBeenCalledExactlyOnceWith(item.id, { limit: 20 });
    expect(port.writerHealth?.()).toEqual({ state: "available" });
    const options = { maxScanRows: 10 };
    await port.listSummaries({ limit: 5 }, options);
    expect(content.listSummaries).toHaveBeenCalledExactlyOnceWith({ limit: 5 }, options);
    expect(leases.getMany).not.toHaveBeenCalled();
  });
});
