// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Node-local composition of the published grants store for shared programs. */
import {
	type AdminCheck,
	createPostgresAgentGrantsStore,
	type GuardDeps,
	resolveInternalPrincipal,
	type SqlTag,
	type WithStore,
} from "@cogni/agent-grants";
import type { NodeAdminAuthority } from "@cogni-dao/knowledge-store";
import type { Logger } from "pino";

export interface AgentAuthoritySql extends SqlTag {
	begin<T>(fn: (tx: SqlTag) => Promise<T>): Promise<T>;
}

export function createSharedAgentAuthority(
	sql: AgentAuthoritySql,
	nodeAdmin: NodeAdminAuthority,
	log: Logger,
) {
	const withStore: WithStore = async (fn) => {
		try {
			return await sql.begin((tx) => fn(createPostgresAgentGrantsStore(tx)));
		} catch (error) {
			// Do not log SQL messages or values. Retain the class and SQLSTATE to diagnose missing schema.
			const code =
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				typeof error.code === "string"
					? error.code
					: undefined;
			log.error(
				{
					event: "agent_authority.store_unavailable",
					errorName: error instanceof Error ? error.name : "unknown",
					...(code && { code }),
				},
				"agent authority store unavailable",
			);
			throw error;
		}
	};
	const adminCheck: AdminCheck = async (userId) => {
		const rows =
			(await sql`SELECT external_id FROM user_bindings WHERE user_id = ${userId} AND provider = 'wallet' ORDER BY external_id LIMIT 20`) as ReadonlyArray<{
				external_id: string;
			}>;
		if (!rows.length) {
			const result = await nodeAdmin.check({ userId });
			return !result.ok && result.errorCode === "authz_unavailable"
				? "unavailable"
				: "denied";
		}
		for (const row of rows) {
			const result = await nodeAdmin.check({
				userId,
				walletAddress: row.external_id,
			});
			if (result.ok) return "allow";
			if (result.errorCode === "authz_unavailable") return "unavailable";
		}
		return "denied";
	};
	const guardDeps: Omit<GuardDeps, "runAs"> = {
		withStore,
		adminCheck,
		onDecision: (decision) =>
			log.info(
				{ event: "agent_tool.authz", ...decision },
				"agent tool authorization",
			),
	};
	return {
		guardDeps,
		resolvePrincipal: (slug: string) =>
			withStore((store) => resolveInternalPrincipal(store, slug)),
	};
}
