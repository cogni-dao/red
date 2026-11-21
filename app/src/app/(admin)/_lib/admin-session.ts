// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Sole opaque AI-admin session mint. Same identity and authority for cookies/bearers. */
import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import type { AdminSession } from "@/ports/node-admin.port";
import { EVENT_NAMES } from "@/shared/observability";

export type AdminSessionResult =
	| { readonly ok: true; readonly session: AdminSession }
	| { readonly ok: false; readonly response: NextResponse };

const refuse = (error: string, status: number): AdminSessionResult => ({
	ok: false,
	response: NextResponse.json(
		{ error },
		{ status, headers: { "cache-control": "no-store" } },
	),
});

export async function requireAdminSession(
	request: Request,
	action: string,
): Promise<AdminSessionResult> {
	try {
		const user = await getSessionUser();
		if (!user) return refuse("unauthorized", 401);
		const bearer =
			request.headers
				.get("authorization")
				?.toLowerCase()
				.startsWith("bearer ") === true;
		// Cookie mutations must originate at this page. JSON is also enforced by the route.
		if (
			!bearer &&
			request.method !== "GET" &&
			request.headers.get("origin") !== new URL(request.url).origin
		) {
			return refuse("authz_denied", 403);
		}
		const container = getContainer();
		const allowed = await container.agentAuthority.guardDeps.adminCheck(
			user.id,
		);
		if (allowed === "unavailable") return refuse("authz_unavailable", 503);
		if (allowed !== "allow") return refuse("authz_denied", 403);
		container.log.info(
			{
				event: EVENT_NAMES.ADMIN_ACTION,
				action,
				adminUserId: user.id,
				via: bearer ? "bearer" : "session",
			},
			EVENT_NAMES.ADMIN_ACTION,
		);
		return {
			ok: true,
			session: Object.freeze({ userId: user.id }) as AdminSession,
		};
	} catch {
		return refuse("authz_unavailable", 503);
	}
}
