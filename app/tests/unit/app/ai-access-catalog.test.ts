// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * The admin table is derived from the tool contracts and the graph catalog, never from a hardcoded scope: every scope a
 * node AI's remaining tools declare shows with On/Off, and a live grant written before the derivation still reads On.
 */
import { CORE_TOOL_BUNDLE, ROUTE_TWIN_CONTRACTS } from "@cogni/ai-tools";
import { describe, expect, it, vi } from "vitest";

const NODE_AI = "00000000-0000-4000-a000-0000000a0001";
const rowsFor = vi.hoisted(() => ({ own: [] as Record<string, unknown>[], principals: [] as Record<string, unknown>[] }));

import {
	type AgentAuthoritySql,
	createAgentToolAuthority,
} from "@/bootstrap/agent-authority";

// The package host owns the store, so this fake speaks SQL: it answers the three reads the admin table makes, by the table each names.
const sqlFake = (strings: TemplateStringsArray): Record<string, unknown>[] => {
	const text = strings.join("?");
	if (text.includes("SELECT user_id, slug FROM agent_principals")) return rowsFor.principals;
	if (text.includes("count(*)")) return [{ n: 0 }];
	if (text.includes("JOIN agent_principals p ON p.user_id = r.principal_user_id AND p.kind = 'internal'")) return rowsFor.own;
	return [];
};

const authority = createAgentToolAuthority({
	sql: Object.assign(sqlFake, {
		begin: async (fn: (tx: unknown) => unknown) => fn(sqlFake),
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
				"red.http_request",
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
		rowsFor.principals = [{ user_id: NODE_AI, slug: "node-ai" }];
		rowsFor.own = [
			{
				id: "00000000-0000-4000-8000-000000000001",
				principal_user_id: NODE_AI,
				scope: "sandbox:exec",
				approved_by: "00000000-0000-4000-8000-0000000000aa",
				created_at: new Date("2026-11-01T00:00:00.000Z"),
				resource: "node",
				account_id: null,
				expires_at: null,
				slug: "node-ai",
				kind: "internal",
				user_name: "node-ai",
				github_id: null,
			},
		];
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
