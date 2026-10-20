// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO
/**
 * Module: sandbox capability authorization tests
 * Purpose: Verify trusted graph/actor/thread binding and metadata-only terminal events.
 * Scope: Bootstrap wiring against injected global HTTP fixture responses.
 * Invariants: GRAPH_OPT_IN; WORKSPACE_FROM_LAUNCHER; NO_SECRETS_IN_LOGS.
 * Side-effects: mocked fetch only
 * @internal
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type ExecutionScope,
	runInScope,
} from "@/adapters/server/ai/execution-scope";
import { createSandboxCapability } from "@/bootstrap/capabilities/sandbox";
import { makeNoopLogger } from "@/shared/observability/server/logger";

const scope: ExecutionScope = {
	graphId: "langgraph:red-solver",
	runId: "run-fixture",
	stateKey: "thread-fixture",
	actorUserId: "trusted",
	billing: {
		billingAccountId: "billing-fixture",
		virtualKeyId: "vkey-fixture",
	},
	usageSource: "litellm",
	llmService: {
		async completionStream() {
			throw new Error("No LLM calls in fixture");
		},
	},
};
const env = {
	SANDBOX_BASE_URL: "https://sandbox.example",
	SANDBOX_EXECD_TOKEN: "fixture-service-token-with-32-characters",
	SANDBOX_ALLOWED_ACTOR_IDS: "trusted,second-trusted",
};
afterEach(() => vi.unstubAllGlobals());
describe("trusted sandbox capability", () => {
	it("uses the isolated-service host from authenticated app configuration", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("proof"));
		vi.stubGlobal("fetch", fetcher);
		const cap = createSandboxCapability(
			{
				...env,
				SANDBOX_BASE_URL: undefined,
				APP_BASE_URL: "https://red-test.cognidao.org",
			},
			makeNoopLogger(),
			"red",
		);
		await runInScope(scope, () => cap.readFile({ path: "proof.txt" }));
		expect(String(fetcher.mock.calls[0]?.[0])).toMatch(
			/^https:\/\/red-sandbox-test\.cognidao\.org\//,
		);
	});
	it("requires explicit actor allowlist, graph opt-in and thread context", async () => {
		const fetcher = vi.fn<typeof fetch>();
		vi.stubGlobal("fetch", fetcher);
		const log = makeNoopLogger();
		const disabled = createSandboxCapability(
			{ ...env, SANDBOX_ALLOWED_ACTOR_IDS: "" },
			log,
			"red",
		);
		expect(
			(await disabled.exec({ action: "start", command: "id" })).status,
		).toBe("unavailable");
		const cap = createSandboxCapability(env, log, "red");
		for (const override of [
			{ actorUserId: "untrusted" },
			{ graphId: "langgraph:poet" },
			{ stateKey: undefined },
			{ actorUserId: undefined },
		]) {
			const result = await runInScope({ ...scope, ...override }, () =>
				cap.exec({ action: "start", command: "id" }),
			);
			expect(result.status).toBe("unavailable");
		}
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("derives distinct workspaces from authenticated account, actor and thread", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockImplementation(async () => new Response("proof"));
		vi.stubGlobal("fetch", fetcher);
		const cap = createSandboxCapability(env, makeNoopLogger(), "red");
		for (const override of [
			{},
			{ actorUserId: "second-trusted" },
			{ stateKey: "thread-2" },
			{ billing: { ...scope.billing, billingAccountId: "billing-2" } },
		]) {
			await runInScope({ ...scope, ...override }, () =>
				cap.readFile({ path: "proof.txt" }),
			);
		}
		const paths = fetcher.mock.calls.map(([url]) =>
			new URL(String(url)).searchParams.get("path"),
		);
		expect(new Set(paths).size).toBe(4);
		expect(
			paths.every((path) =>
				/^\/workspace\/[a-f0-9]{64}\/proof.txt$/.test(path ?? ""),
			),
		).toBe(true);
		expect(paths.join()).not.toContain("billing-fixture");
	});
	it("returns unknown after a lost acknowledgement and emits one safe terminal event", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response())
			.mockRejectedValueOnce(new Error(`remote ${env.SANDBOX_EXECD_TOKEN}`));
		vi.stubGlobal("fetch", fetcher);
		const log = makeNoopLogger().child({ nodeId: "node-fixture" });
		const terminal = vi.spyOn(log, "info");
		const cap = createSandboxCapability(env, log, "red");
		const result = await runInScope(scope, () =>
			cap.exec({ action: "start", command: "sensitive fixture command" }),
		);
		expect(result.status).toBe("unknown");
		expect(result.message).toContain("Do not retry");
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(terminal).toHaveBeenCalledTimes(1);
		expect(terminal.mock.calls[0]?.[0]).toMatchObject({
			event: "adapter.sandbox.result",
			reqId: "run-fixture",
			outcome: "unknown",
			reasonCode: "transport",
		});
		const records = JSON.stringify(terminal.mock.calls);
		expect(records).not.toContain(env.SANDBOX_EXECD_TOKEN);
		expect(records).not.toContain(env.SANDBOX_BASE_URL);
		expect(records).not.toContain("sensitive fixture command");
		expect(log.bindings().nodeId).toBe("node-fixture");
	});
});
