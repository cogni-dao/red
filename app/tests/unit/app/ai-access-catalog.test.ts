// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * The admin table is derived from the tool contracts and the graph catalog, never from a hardcoded scope: every scope a
 * node AI's remaining tools declare shows with On/Off, and a live grant written before the derivation still reads On.
 */
import { CORE_TOOL_BUNDLE, ROUTE_TWIN_CONTRACTS } from "@cogni/ai-tools";
import { describe, expect, it, vi } from "vitest";

const NODE_AI = "00000000-0000-4000-a000-0000000a0001";
const store = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@cogni/agent-grants", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cogni/agent-grants")>()),
	createPostgresAgentGrantsStore: () => store.current,
}));

import {
	type AgentAuthoritySql,
	createAgentToolAuthority,
} from "@/bootstrap/agent-authority";

const authority = createAgentToolAuthority({
	sql: Object.assign(() => [], {
		begin: async (fn: (tx: unknown) => unknown) => fn(undefined),
	}) as unknown as AgentAuthoritySql,
	nodeAdmin: {} as never,
	log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as never,
	toolBundle: [...CORE_TOOL_BUNDLE, ...ROUTE_TWIN_CONTRACTS],
});

describe("AI access permission catalog", () => {
	it("declares the scope of every non-read tool contract", () => {
		expect(authority.declaredScopes).toEqual(
			expect.arrayContaining([
				"account:read",
				"edo:write",
				"knowledge:write",
				"sandbox:exec",
				"schedule:manage",
				"vcs:create_branch",
				"vcs:flight_candidate",
				"vcs:merge_pr",
				"work_item:transition",
			]),
		);
	});

	it("lists node AI scopes from its graphs' tools; the pre-existing sandbox:exec grant is On", async () => {
		store.current = {
			listInternalPrincipals: async () => [
				{ userId: NODE_AI, slug: "node-ai" },
			],
			listRoleRows: async () => ({
				more: 0,
				rows: [
					{
						principalUserId: NODE_AI,
						slug: "node-ai",
						internal: true,
						name: "node-ai",
						hint: null,
						scope: "sandbox:exec",
						state: "granted",
						at: "2026-11-01T00:00:00.000Z",
						rowId: "00000000-0000-4000-8000-000000000001",
						resource: "node",
						accountId: null,
						expiresAt: null,
					},
				],
			}),
		};
		const { permissions } = await authority.listNodeAi();
		const byScope = Object.fromEntries(permissions.map((p) => [p.scope, p]));
		expect(byScope["sandbox:exec"]).toMatchObject({
			principalUserId: NODE_AI,
			on: true,
		});
		expect(byScope["schedule:manage"]).toMatchObject({
			principalUserId: NODE_AI,
			on: false,
		});
		for (const p of permissions) {
			expect(p.label).toBeTruthy();
			expect(p.description).toBeTruthy();
		}
	});
});
