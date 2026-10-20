// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@bootstrap/capabilities/sandbox`
 * Purpose: Bind execd to authenticated Red graph/thread context without exposing credentials.
 * Scope: Composition and authorization; execution remains in the adapter and ToolRunner.
 * Invariants: TRUSTED_ACTORS_ONLY; GRAPH_OPT_IN; WORKSPACE_FROM_LAUNCHER.
 * Side-effects: terminal observability event per authorized operation
 * Links: services/sandbox/README.md
 * @internal
 */
import { createHash } from "node:crypto";
import {
	type SandboxCapability,
	type SandboxOutput,
	unavailableSandboxCapability,
} from "@cogni/ai-tools";
import { EVENT_NAMES, logEvent } from "@cogni/node-shared";
import { getExecutionScope } from "@/adapters/server/ai/execution-scope";
import {
	ExecdClient,
	ExecdClientError,
} from "@/adapters/server/sandbox/execd.client";
import type { ServerEnv } from "@/shared/env";
import type { Logger } from "@/shared/observability/server";

export function createSandboxCapability(
	env: Pick<
		ServerEnv,
		"SANDBOX_URL" | "SANDBOX_EXECD_TOKEN" | "SANDBOX_ALLOWED_ACTOR_IDS"
	>,
	log: Logger,
): SandboxCapability {
	const actors = new Set(
		(env.SANDBOX_ALLOWED_ACTOR_IDS ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
	if (!env.SANDBOX_URL || !env.SANDBOX_EXECD_TOKEN || actors.size === 0)
		return unavailableSandboxCapability;
	const client = new ExecdClient({
		url: env.SANDBOX_URL,
		token: env.SANDBOX_EXECD_TOKEN,
	});
	async function invoke(
		operation: "exec" | "read_file" | "write_file",
		fn: (workspace: string) => Promise<SandboxOutput>,
	): Promise<SandboxOutput> {
		const scope = getExecutionScope();
		if (
			scope.graphId !== "langgraph:red-solver" ||
			!scope.actorUserId ||
			!actors.has(scope.actorUserId) ||
			!scope.stateKey ||
			!scope.runId
		) {
			return unavailableSandboxCapability.exec({ action: "poll" });
		}
		const workspace = `/workspace/${createHash("sha256")
			.update(
				JSON.stringify([
					scope.billing.billingAccountId,
					scope.actorUserId,
					scope.stateKey,
				]),
			)
			.digest("hex")}`;
		const started = Date.now();
		let result: SandboxOutput;
		let reasonCode = "none";
		try {
			result = await fn(workspace);
      if (result.status === "error") reasonCode = "command_failed";
      if (result.status === "unknown") reasonCode = "output_limit";
		} catch (error) {
			reasonCode =
				error instanceof ExecdClientError ? error.reasonCode : "protocol";
			const ambiguous = error instanceof ExecdClientError && error.ambiguous;
			result = {
				status: ambiguous ? "unknown" : "error",
				output: "",
				truncated: false,
				message: ambiguous
					? "Execution may already have occurred. Do not retry the command; report uncertainty."
					: `Sandbox operation failed (${reasonCode}).`,
			};
		}
		logEvent(log, EVENT_NAMES.ADAPTER_SANDBOX_RESULT, {
			reqId: scope.runId,
			operation,
			outcome: result.status,
			reasonCode,
			durationMs: Date.now() - started,
			outputBytes: Buffer.byteLength(result.output),
		});
		return result;
	}
	return {
		exec: (input) =>
			invoke("exec", (workspace) => client.exec(workspace, input)),
		readFile: (input) =>
			invoke("read_file", (workspace) => client.readFile(workspace, input)),
		writeFile: (input) =>
			invoke("write_file", (workspace) => client.writeFile(workspace, input)),
	};
}
