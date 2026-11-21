// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Stock 0.13.0 table endpoint. Internal Cogni sandbox permission only. */
import { AgentRolesError } from "@cogni/agent-grants";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/app/(admin)/_lib/admin-session";
import { getContainer } from "@/bootstrap/container";
import { EVENT_NAMES, makeLogger } from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const json = (body: unknown, status = 200) =>
	NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
// Strict input refuses caller-supplied approver/admin, account, ask or link fields.
const targetSchema = z
	.object({
		principalUserId: z.string().min(1).max(128),
		scope: z.literal("sandbox:exec"),
	})
	.strict();

async function handle(request: Request, operation: "list" | "on" | "off") {
	const admin = await requireAdminSession(request, `ai_access.${operation}`);
	if (!admin.ok) return admin.response;
	try {
		const port = getContainer().nodeAdminPort;
		if (operation === "list")
			return json({
				canManage: true,
				...(await port.listNodeAi(admin.session)),
			});
		if (
			request.headers
				.get("content-type")
				?.split(";")[0]
				?.trim()
				.toLowerCase() !== "application/json"
		)
			return json({ error: "invalid_input" }, 400);
		const parsed = targetSchema.safeParse(
			await request.json().catch(() => null),
		);
		if (!parsed.success) return json({ error: "invalid_input" }, 400);
		return json(
			operation === "on"
				? await port.turnAiPermissionOn(admin.session, parsed.data)
				: await port.turnAiPermissionOff(admin.session, parsed.data),
		);
	} catch (error) {
		if (error instanceof AgentRolesError) {
			const status =
				error.code === "principal_not_found"
					? 503
					: error.code === "self_approval" || error.code === "not_allowed"
						? 403
						: 400;
			return json({ error: error.code }, status);
		}
		makeLogger({ route: "admin.ai-access" }).error(
			{ event: EVENT_NAMES.AGENT_ROLES_UNAVAILABLE, operation },
			"AI permission store unavailable",
		);
		return json({ error: "authz_unavailable" }, 503);
	}
}

export const GET = (request: Request) => handle(request, "list");
export const POST = (request: Request) => handle(request, "on");
export const DELETE = (request: Request) => handle(request, "off");
