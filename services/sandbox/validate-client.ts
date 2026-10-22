// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO
/**
 * Module: sandbox runtime validation fixture
 * Purpose: Exercise execd transport through shared tool contracts and ToolRunner; not application authorization or agent proof.
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
	bindExecdWorkspace,
	ExecdClient,
} from "../../app/src/adapters/server/sandbox/execd.client";

async function main() {
	const url = process.env.SANDBOX_BASE_URL;
	const token = process.env.SANDBOX_EXECD_TOKEN;
	assert(url && token, "Fixture URL/token required");
	// Fixture-owned adapter workspaces only. This does not authorize any app caller.
	const scope = `/workspace/${"a".repeat(64)}`;
	const second = `/workspace/${"b".repeat(64)}`;
	const client = new ExecdClient({ url, token });
	const names = [
		SANDBOX_EXEC_NAME,
		SANDBOX_READ_FILE_NAME,
		SANDBOX_WRITE_FILE_NAME,
	];
	let eventCount = 0;
	function sourceFor(workspace: string) {
		const capability = bindExecdWorkspace(client, workspace);
		return createStaticToolSource([
			contractToRuntime(sandboxExecContract, {
				execute: capability.exec,
			}),
			contractToRuntime(sandboxReadFileContract, {
				execute: capability.readFile,
			}),
			contractToRuntime(sandboxWriteFileContract, {
				execute: capability.writeFile,
			}),
		]);
	}
	function fixtureRunner(workspace: string) {
		return createToolRunner(
			sourceFor(workspace),
			() => {
				eventCount++;
			},
			{
				policy: createToolAllowlistPolicy(names),
				ctx: { runId: "sandbox-transport-fixture" },
			},
		);
	}
	const runner = fixtureRunner(scope);
	const secondRunner = fixtureRunner(second);
	const checks: string[] = [];
	async function tool(name: string, args: unknown, context = scope) {
		const result = await (context === scope ? runner : secondRunner).exec(
			name,
			args,
		);
		return result.ok
			? result.value
			: {
					status: "error",
					output: "",
					truncated: false,
					message: result.safeMessage,
				};
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
	const version = await fetch(`${url}/version`, { redirect: "error" });
	assert.equal(version.status, 200);
	assert.equal(
		((await version.json()) as { buildSha: string }).buildSha,
		process.env.SANDBOX_PROOF_SHA,
	);
	checks.push("front-door build SHA");
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
	const hardening = await ok(SANDBOX_EXEC_NAME, {
		action: "shell",
		command: `python3 - <<'PYTHON'
import os
assert not any(k in os.environ for k in ('EXECD_ACCESS_TOKEN', 'SANDBOX_EXECD_TOKEN'))
try:
    open('/proc/1/environ', 'rb').read()
except PermissionError:
    print('credential-env-absent;daemon-env-denied')
else:
    raise AssertionError('daemon credential environment readable')
PYTHON`,
	});
	assert.equal(
		hardening.output.trim(),
		"credential-env-absent;daemon-env-denied",
	);
	checks.push("workload token stripping and daemon environ denial");
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
	const invalid = await runner.exec(SANDBOX_READ_FILE_NAME, {
		path: "../outside",
	});
	assert(!invalid.ok);
	checks.push("ToolRunner rejects traversal input");
	const denyRunner = createToolRunner(sourceFor(scope), () => {});
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
