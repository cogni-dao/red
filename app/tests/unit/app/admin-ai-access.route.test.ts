// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Real resolver, sole mint, port and published grant policy; only IO is faked. */
import type { AgentGrantsStore, WithStore } from "@cogni/agent-grants";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({
	headers: new Headers(),
	session: vi.fn(),
	container: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => io.headers }));
vi.mock("@/lib/auth/server", () => ({
	getServerSessionUser: () => io.session(),
}));
vi.mock("@/bootstrap/container", () => ({
	getContainer: () => io.container(),
}));
vi.mock("@/shared/env/server", () => ({
	serverEnv: () => ({ AUTH_SECRET: "unit-test-only" }),
}));

import { issueAgentApiKey } from "@/app/_lib/auth/request-identity";
import { DELETE, GET, POST } from "@/app/api/v1/admin/ai-access/route";
import { createNodeAdminPort } from "@/bootstrap/node-admin-port";

const PRINCIPAL = "00000000-0000-4000-a000-0000000a0001";
const SCOPE = "sandbox:exec";
const ADMIN = "admin-fixture";
const log = pino({ level: "silent" });
const adminCheck = vi.fn();
const findInternalPrincipal = vi.fn();
const hasLiveRole = vi.fn();
const approvePending = vi.fn();
const insertRole = vi.fn();
const revokeRole = vi.fn();
const storeMethods = {
	findInternalPrincipal,
	hasLiveRole,
	approvePending,
	insertRole,
	revokeRole,
};
// Any accidental list/account read fails this test; no policy logic is reproduced.
const store = new Proxy({} as AgentGrantsStore, {
	get: (_target, key) => {
		if (typeof key === "string" && key in storeMethods)
			return storeMethods[key as keyof typeof storeMethods];
		throw new Error(`unexpected store method: ${String(key)}`);
	},
});
const withStore: WithStore = async (fn) => fn(store);

function request(
	method: string,
	body?: unknown,
	options: { userId?: string; bearer?: boolean; origin?: string | null } = {},
) {
	const userId = options.userId ?? ADMIN;
	const headers = new Headers({
		host: "red.example",
		"content-type": "application/json",
	});
	if (options.origin !== null)
		headers.set("origin", options.origin ?? "https://red.example");
	if (options.bearer)
		headers.set(
			"authorization",
			`Bearer ${issueAgentApiKey({ userId, displayName: "Fixture" })}`,
		);
	io.headers = headers;
	io.session.mockResolvedValue({
		id: userId,
		walletAddress: "0xfixture",
		displayName: "Fixture",
		avatarColor: null,
	});
	return new Request("https://red.example/api/v1/admin/ai-access", {
		method,
		headers,
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
}

const target = { principalUserId: PRINCIPAL, scope: SCOPE };

beforeEach(() => {
	vi.clearAllMocks();
	adminCheck.mockImplementation(async (id: string) =>
		id === ADMIN ? "allow" : "denied",
	);
	findInternalPrincipal.mockResolvedValue({ userId: PRINCIPAL });
	hasLiveRole.mockResolvedValue(false);
	approvePending.mockResolvedValue(false);
	insertRole.mockResolvedValue(true);
	revokeRole.mockResolvedValue(true);
	io.container.mockReturnValue({
		log,
		agentAuthority: { guardDeps: { adminCheck, withStore } },
		nodeAdminPort: createNodeAdminPort(withStore, log),
	});
});

describe("internal AI permission HTTP and port composition", () => {
	it("lists exactly the internal node permission from a fresh live-role boolean", async () => {
		const first = await GET(request("GET"));
		expect(first.status).toBe(200);
		expect(first.headers.get("cache-control")).toBe("no-store");
		expect(await first.json()).toMatchObject({
			canManage: true,
			more: 0,
			permissions: [
				{
					...target,
					section: "node",
					resource: "node",
					outside: false,
					on: false,
				},
			],
		});
		hasLiveRole.mockResolvedValueOnce(true);
		const second = await GET(request("GET"));
		const body = await second.json();
		expect(body.permissions).toHaveLength(1);
		expect(body.permissions[0].on).toBe(true);
		expect(hasLiveRole).toHaveBeenCalledWith(PRINCIPAL, SCOPE);
		expect(findInternalPrincipal).toHaveBeenCalledWith("node-ai");
		expect(insertRole).not.toHaveBeenCalled();
	});

	it.each([false, true])(
		"uses the same authenticated admin for cookie/bearer On and Off (bearer=%s)",
		async (bearer) => {
			const on = await POST(request("POST", target, { bearer }));
			expect(on.status).toBe(200);
			expect(await on.json()).toEqual({ changed: true });
			expect(insertRole).toHaveBeenCalledWith({
				principalUserId: PRINCIPAL,
				scope: SCOPE,
				approvedBy: ADMIN,
			});
			const off = await DELETE(request("DELETE", target, { bearer }));
			expect(off.status).toBe(200);
			expect(await off.json()).toEqual({ changed: true });
			expect(revokeRole).toHaveBeenCalledWith({
				principalUserId: PRINCIPAL,
				scope: SCOPE,
			});
			expect(adminCheck).toHaveBeenNthCalledWith(1, ADMIN);
			expect(adminCheck).toHaveBeenNthCalledWith(2, ADMIN);
		},
	);

	it.each([false, true])(
		"refuses a nonadmin before any permission read/write (bearer=%s)",
		async (bearer) => {
			const res = await POST(
				request("POST", target, { bearer, userId: "member" }),
			);
			expect(res.status).toBe(403);
			expect(findInternalPrincipal).not.toHaveBeenCalled();
			expect(insertRole).not.toHaveBeenCalled();
		},
	);

	it("refuses missing identity and invalid bearer without cookie fallback", async () => {
		const req = request("GET");
		io.session.mockResolvedValueOnce(null);
		expect((await GET(req)).status).toBe(401);
		const bad = request("POST", target);
		io.headers.set("authorization", "Bearer invalid");
		bad.headers.set("authorization", "Bearer invalid");
		expect((await POST(bad)).status).toBe(401);
		expect(adminCheck).not.toHaveBeenCalled();
	});

	it.each(["https://foreign.example", null])(
		"refuses cookie writes with unsafe/missing origin %s",
		async (origin) => {
			expect(
				(await POST(request("POST", target, { origin }))).status,
			).toBeGreaterThanOrEqual(400);
			expect(insertRole).not.toHaveBeenCalled();
		},
	);

	it.each([
		{ ...target, scope: "account:read" },
		{ ...target, scope: "unknown" },
		{ ...target, approvedBy: "forged" },
		{ ...target, admin: true },
		{ ...target, accountId: "foreign" },
		{ ...target, deny: true },
	])(
		"refuses unsupported or caller-authority fields before store IO: %j",
		async (body) => {
			expect((await POST(request("POST", body))).status).toBe(400);
			expect(findInternalPrincipal).not.toHaveBeenCalled();
			expect(insertRole).not.toHaveBeenCalled();
		},
	);

	it("refuses a foreign principal before either published writer", async () => {
		expect(
			(await POST(request("POST", { ...target, principalUserId: "outside" })))
				.status,
		).toBe(403);
		expect(
			(
				await DELETE(
					request("DELETE", { ...target, principalUserId: "outside" }),
				)
			).status,
		).toBe(403);
		expect(approvePending).not.toHaveBeenCalled();
		expect(insertRole).not.toHaveBeenCalled();
		expect(revokeRole).not.toHaveBeenCalled();
	});

	it("keeps published NO_SELF_APPROVAL on both On and Off", async () => {
		adminCheck.mockResolvedValue("allow");
		expect(
			(await POST(request("POST", target, { bearer: true, userId: PRINCIPAL })))
				.status,
		).toBe(403);
		expect(
			(
				await DELETE(
					request("DELETE", target, { bearer: true, userId: PRINCIPAL }),
				)
			).status,
		).toBe(403);
		expect(insertRole).not.toHaveBeenCalled();
		expect(revokeRole).not.toHaveBeenCalled();
	});

	it("preserves idempotent published On/Off results", async () => {
		insertRole.mockResolvedValue(false);
		revokeRole.mockResolvedValue(false);
		expect(await (await POST(request("POST", target))).json()).toEqual({
			changed: false,
		});
		expect(await (await DELETE(request("DELETE", target))).json()).toEqual({
			changed: false,
		});
	});

	it("fails closed on unavailable admin config, principal and grant store", async () => {
		adminCheck.mockResolvedValueOnce("unavailable");
		expect((await POST(request("POST", target))).status).toBe(503);
		findInternalPrincipal.mockResolvedValueOnce(null);
		expect((await GET(request("GET"))).status).toBe(503);
		hasLiveRole.mockRejectedValueOnce(new Error("secret SQL details"));
		const res = await GET(request("GET"));
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: "authz_unavailable" });
		insertRole.mockRejectedValueOnce(new Error("secret SQL details"));
		expect((await POST(request("POST", target))).status).toBe(503);
		expect(revokeRole).not.toHaveBeenCalled();
	});
});
