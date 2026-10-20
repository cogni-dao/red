// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO
/**
 * Module: sandbox runtime validation fixture
 * Purpose: Exercise real execd through the production capability and ToolRunner, without model spend.
 * Scope: Self-owned local fixture only; no remote target or deployment operations.
 * Side-effects: Fixture commands and workspace files
 * @internal
 */
import assert from "node:assert/strict";
import {
	createStaticToolSource,
	createToolAllowlistPolicy,
	createToolRunner,
} from "@cogni/ai-core";
import {
	contractToRuntime,
	SANDBOX_EXEC_NAME,
	SANDBOX_READ_FILE_NAME,
	SANDBOX_WRITE_FILE_NAME,
	sandboxExecContract,
	sandboxReadFileContract,
	sandboxWriteFileContract,
} from "@cogni/ai-tools";
import {
	type ExecutionScope,
	runInScope,
} from "../../app/src/adapters/server/ai/execution-scope";
import { createSandboxCapability } from "../../app/src/bootstrap/capabilities/sandbox";
import { makeNoopLogger } from "../../app/src/shared/observability/server/logger";

async function main() {
	const url = process.env.SANDBOX_URL;
	const token = process.env.SANDBOX_EXECD_TOKEN;
	assert(url && token, "Fixture URL/token required");
	const scope: ExecutionScope = {
		graphId: "langgraph:red-solver",
		runId: "sandbox-runtime-proof",
		stateKey: "thread-a",
		actorUserId: "fixture-owner",
		billing: {
			billingAccountId: "fixture-account",
			virtualKeyId: "fixture-key",
		},
		usageSource: "litellm",
		llmService: {
			async completionStream() {
				throw new Error("Fixture never calls an LLM");
			},
		},
	};
	const capability = createSandboxCapability(
		{
			SANDBOX_URL: url,
			SANDBOX_EXECD_TOKEN: token,
			SANDBOX_ALLOWED_ACTOR_IDS: "fixture-owner",
		},
		makeNoopLogger(),
	);
	const source = createStaticToolSource([
		contractToRuntime(sandboxExecContract, { execute: capability.exec }),
		contractToRuntime(sandboxReadFileContract, {
			execute: capability.readFile,
		}),
		contractToRuntime(sandboxWriteFileContract, {
			execute: capability.writeFile,
		}),
	]);
	const names = [
		SANDBOX_EXEC_NAME,
		SANDBOX_READ_FILE_NAME,
		SANDBOX_WRITE_FILE_NAME,
	];
	let eventCount = 0;
	const runner = createToolRunner(
		source,
		() => {
			eventCount++;
		},
		{
			policy: createToolAllowlistPolicy(names),
			ctx: { runId: scope.runId ?? "fixture" },
		},
	);
	const checks: string[] = [];
	async function tool(name: string, args: unknown, context = scope) {
		const result = await runInScope(context, () => runner.exec(name, args));
		assert(result.ok, `ToolRunner rejected ${name}`);
		return result.value;
	}
	async function ok(name: string, args: unknown, context = scope) {
		const value = await tool(name, args, context);
		assert.equal(
			value.status,
			"ok",
			`${name}${typeof args === "object" && args !== null && "action" in args ? `/${String(args.action)}` : ""}: ${String(value.message)}`,
		);
		assert(
			!JSON.stringify(value).includes(token ?? "missing"),
			"Token leaked to tool output",
		);
		return value;
	}
	const denied = await fetch(`${url}/command/status/fixture`, {
		redirect: "error",
	});
	assert([401, 403].includes(denied.status));
	checks.push("token authentication");
	await ok(SANDBOX_WRITE_FILE_NAME, {
		path: "nested/proof.txt",
		content: "thread-a-proof",
	});
	assert.equal(
		(await ok(SANDBOX_READ_FILE_NAME, { path: "nested/proof.txt" })).output,
		"thread-a-proof",
	);
	checks.push("file write/read through ToolRunner");
	const second = { ...scope, stateKey: "thread-b" };
	assert.equal(
		(await tool(SANDBOX_READ_FILE_NAME, { path: "nested/proof.txt" }, second))
			.status,
		"error",
	);
	await ok(
		SANDBOX_WRITE_FILE_NAME,
		{ path: "nested/proof.txt", content: "thread-b-proof" },
		second,
	);
	assert.equal(
		(await ok(SANDBOX_READ_FILE_NAME, { path: "nested/proof.txt" })).output,
		"thread-a-proof",
	);
	checks.push("distinct thread workspaces (not a security boundary)");
	assert.equal(
		(
			await tool(
				SANDBOX_EXEC_NAME,
				{ action: "shell", command: "id" },
				{ ...scope, actorUserId: "other" },
			)
		).status,
		"unavailable",
	);
	assert.equal(
		(
			await tool(
				SANDBOX_EXEC_NAME,
				{ action: "shell", command: "id" },
				{ ...scope, graphId: "langgraph:poet" },
			)
		).status,
		"unavailable",
	);
	checks.push("trusted actor and graph opt-in");
	await ok(SANDBOX_EXEC_NAME, {
		action: "shell",
		command: "export RED_FIXTURE_STATE=persistent",
	});
	assert.equal(
		(
			await ok(SANDBOX_EXEC_NAME, {
				action: "shell",
				command: 'printf "$RED_FIXTURE_STATE"',
			})
		).output,
		"persistent",
	);
	checks.push("persistent shell state");
	const command = await ok(SANDBOX_EXEC_NAME, {
		action: "start",
		command: "printf retained-proof",
		timeoutMs: 10000,
	});
	assert.equal(typeof command.commandId, "string");
	let finished = false;
	for (let attempt = 0; attempt < 30; attempt++) {
		const status = await ok(SANDBOX_EXEC_NAME, {
			action: "poll",
			commandId: command.commandId,
		});
		if (status.running === false) {
			assert.equal(status.exitCode, 0);
			finished = true;
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert(
		finished,
		"Background command did not finish within bounded fixture window",
	);
	assert.equal(
		(
			await ok(SANDBOX_EXEC_NAME, {
				action: "logs",
				commandId: command.commandId,
			})
		).output.trim(),
		"retained-proof",
	);
	assert.equal(
		(
			await tool(
				SANDBOX_EXEC_NAME,
				{ action: "poll", commandId: command.commandId },
				second,
			)
		).status,
		"error",
	);
	checks.push("background execution/status/retained logs/handle ownership");
	const sleeper = await ok(SANDBOX_EXEC_NAME, {
		action: "start",
		command: "sleep 60",
		timeoutMs: 10000,
	});
	await ok(SANDBOX_EXEC_NAME, {
		action: "signal",
		commandId: sleeper.commandId,
	});
	checks.push("interrupt background process");
	await ok(SANDBOX_EXEC_NAME, { action: "close_shell" });
	const invalid = await runInScope(scope, () =>
		runner.exec(SANDBOX_READ_FILE_NAME, { path: "../outside" }),
	);
	assert(!invalid.ok);
	checks.push("ToolRunner rejects traversal input");
	const denyRunner = createToolRunner(source, () => {});
	assert(
		!(
			await denyRunner.exec(SANDBOX_EXEC_NAME, {
				action: "start",
				command: "id",
			})
		).ok,
	);
	checks.push("ToolRunner deny by default");
	console.log(
		JSON.stringify({
			passed: checks.length,
			checks,
			toolEvents: eventCount,
			modelCalls: 0,
		}),
	);
}
main().catch((error: unknown) => {
	console.error(
		error instanceof Error ? error.message : "Sandbox fixture failed",
	);
	process.exitCode = 1;
});
