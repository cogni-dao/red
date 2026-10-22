// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO
/**
 * Module: sandbox execd protocol tests
 * Purpose: Prove credential containment, command ownership, bounded responses and no retries.
 * Scope: Adapter against injected HTTP responses; real runtime exercise lives in services/sandbox/validate.sh.
 * Invariants: NO_AUTOMATIC_RETRY; SIGNED_COMMAND_OWNERSHIP; MODEL_CANNOT_OVERRIDE_SCOPE.
 * Side-effects: none
 * @internal
 */

import {
	SandboxExecInputSchema,
	SandboxReadFileInputSchema,
} from "@cogni/ai-tools";
import { describe, expect, it, vi } from "vitest";
import {
	bindExecdWorkspace,
	ExecdClient,
} from "@/adapters/server/sandbox/execd.client";

const token = "fixture-token-with-at-least-32-characters";
const a = `/workspace/${"a".repeat(64)}`;
const b = `/workspace/${"b".repeat(64)}`;
function sse(id = "command-fixture", output = "") {
	return new Response(
		[
			`${JSON.stringify({ type: "init", text: id })}`,
			`${JSON.stringify({ type: "stdout", text: output })}`,
			`${JSON.stringify({ type: "execution_complete" })}`,
		].join("\n\n"),
		{ headers: { "Content-Type": "text/event-stream" } },
	);
}
function setup() {
	const fetcher = vi.fn<typeof fetch>();
	const client = new ExecdClient({
		url: "https://sandbox.example",
		token,
		fetch: fetcher,
	});
	return { client, fetcher };
}
describe("execd trusted transport", () => {
	it("preserves an uncertain command start without retrying or exposing credentials", async () => {
		const { client, fetcher } = setup();
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockRejectedValueOnce(new Error("acknowledgement lost"));
		const result = await bindExecdWorkspace(client, a).exec({
			action: "start",
			command: "printf canary",
		});
		expect(result.status).toBe("unknown");
		expect(result.message).toContain("Do not retry");
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(result)).not.toContain(token);
	});

	it("rejects URL/token/workspace overrides and relative traversal", () => {
		expect(
			SandboxExecInputSchema.safeParse({
				action: "start",
				command: "id",
				url: "https://elsewhere",
			}).success,
		).toBe(false);
		for (const path of ["../other", "/etc/passwd", "a/../b", "a\\b", "a\0b"]) {
			expect(SandboxReadFileInputSchema.safeParse({ path }).success).toBe(
				false,
			);
		}
		expect(
			SandboxReadFileInputSchema.safeParse({ path: "nested/proof.txt" })
				.success,
		).toBe(true);
	});
	it("refuses insecure remote origins and embedded credentials", () => {
		for (const url of [
			"http://sandbox.example",
			"https://u:p@sandbox.example",
			"https://sandbox.example/other",
			"https://sandbox.example?token=x",
		]) {
			expect(() => new ExecdClient({ url, token })).toThrow("Invalid sandbox");
		}
	});
	it("injects credentials only into headers and binds cwd to trusted workspace", async () => {
		const { client, fetcher } = setup();
		fetcher.mockResolvedValueOnce(new Response()).mockResolvedValueOnce(sse());
		const result = await client.exec(a, {
			action: "start",
			command: "printf proof",
		});
		expect(result.status).toBe("ok");
		expect(result.commandId).toBeTruthy();
		const request = fetcher.mock.calls[1];
		expect(new Headers(request?.[1]?.headers).get("X-EXECD-ACCESS-TOKEN")).toBe(
			token,
		);
		expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
			cwd: a,
			background: true,
			timeout: 30000,
		});
		expect(request?.[1]?.redirect).toBe("error");
		expect(JSON.stringify(result)).not.toContain(token);
	});
	it("rejects another thread's command handle before any HTTP call", async () => {
		const { client, fetcher } = setup();
		fetcher.mockResolvedValueOnce(new Response()).mockResolvedValueOnce(sse());
		const started = await client.exec(a, {
			action: "start",
			command: "sleep 2",
		});
		const count = fetcher.mock.calls.length;
		await expect(
			client.exec(b, { action: "poll", commandId: started.commandId }),
		).rejects.toMatchObject({ reasonCode: "scope" });
		await expect(
			client.exec(a, { action: "signal", commandId: `${started.commandId}x` }),
		).rejects.toMatchObject({ reasonCode: "scope" });
		expect(fetcher).toHaveBeenCalledTimes(count);
	});
	it("does not retry a command when the start acknowledgement is lost", async () => {
		const { client, fetcher } = setup();
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockRejectedValueOnce(new Error("ack lost"));
		await expect(
			client.exec(a, { action: "start", command: "write-once" }),
		).rejects.toMatchObject({ reasonCode: "transport", ambiguous: true });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
	it("redacts runtime credentials, endpoint and obvious secrets from output", async () => {
		const { client, fetcher } = setup();
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockResolvedValueOnce(sse("cmd", `${token} https://sandbox.example`));
		const result = await client.exec(a, {
			action: "start",
			command: "fixture",
		});
		expect(result.output).toBe("[redacted] [sandbox]");
		fetcher.mockResolvedValueOnce(new Response("api_key=secret"));
		expect((await client.readFile(a, { path: "proof" })).output).toContain(
			"withheld",
		);
	});
	it("caps file reads in bytes without returning partial credentials", async () => {
		const { client, fetcher } = setup();
		fetcher.mockResolvedValueOnce(new Response("x".repeat(32760) + token));
		const result = await client.readFile(a, { path: "large" });
		expect(result.truncated).toBe(true);
		expect(result.output).toContain("output limit");
		expect(result.output).not.toContain(token.slice(0, 8));
		expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Range")).toBe(
			"bytes=0-32768",
		);
	});
	it("reuses a thread shell and does not reset its cwd between commands", async () => {
		const { client, fetcher } = setup();
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockResolvedValueOnce(Response.json({ session_id: "session-a" }))
			.mockResolvedValueOnce(sse());
		await client.exec(a, {
			action: "shell",
			command: "export PROOF=one; cd /tmp",
		});
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockResolvedValueOnce(sse("cmd2", "one"));
		const result = await client.exec(a, {
			action: "shell",
			command: "printf $PROOF",
		});
		expect(result.output).toBe("one");
		const body = JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body));
		expect(body).not.toHaveProperty("cwd");
		expect(String(fetcher.mock.calls[4]?.[0])).toContain(
			"/session/session-a/run",
		);
	});
	it("reports malformed acknowledgements as ambiguous rather than retrying", async () => {
		const { client, fetcher } = setup();
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockResolvedValueOnce(new Response("not SSE"));
		await expect(
			client.exec(a, { action: "start", command: "write-once" }),
		).rejects.toMatchObject({ ambiguous: true });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
	it("uploads execd metadata as a multipart file part, not a string field", async () => {
		const { client, fetcher } = setup();
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockResolvedValueOnce(new Response());
		expect(
			(
				await client.writeFile(a, {
					path: "nested/proof.txt",
					content: "proof",
				})
			).status,
		).toBe("ok");
		const form = fetcher.mock.calls[1]?.[1]?.body;
		expect(form).toBeInstanceOf(FormData);
		const metadata = (form as FormData).get("metadata");
		expect(metadata).toBeInstanceOf(Blob);
		expect(JSON.parse(await (metadata as Blob).text())).toMatchObject({
			path: `${a}/nested/proof.txt`,
			mode: 600,
		});
	});
	it("does not report a truncated shell acknowledgement as success", async () => {
		const { client, fetcher } = setup();
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockResolvedValueOnce(Response.json({ session_id: "shell-fixture" }))
			.mockResolvedValueOnce(
				new Response('data: {"type":"init","text":"shell-fixture"}'),
			);
		await expect(
			client.exec(a, { action: "shell", command: "write-once" }),
		).rejects.toMatchObject({ ambiguous: true });
		expect(fetcher).toHaveBeenCalledTimes(3);
	});
	it("retains an unknown allocation until upstream cleanup is proven", async () => {
		const { client, fetcher } = setup();
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockRejectedValueOnce(new Error("lost session acknowledgement"));
		await expect(
			client.exec(a, { action: "shell", command: "write-once" }),
		).rejects.toMatchObject({ ambiguous: true });
		await expect(
			client.exec(a, { action: "close_shell" }),
		).rejects.toMatchObject({ ambiguous: true });
		await expect(
			client.exec(a, { action: "shell", command: "replacement" }),
		).rejects.toMatchObject({ ambiguous: true });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it("classifies a malformed allocation as unknown and refuses another allocation", async () => {
		const { client, fetcher } = setup();
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockResolvedValueOnce(Response.json({}));
		const capability = bindExecdWorkspace(client, a);
		expect(
			(await capability.exec({ action: "shell", command: "once" })).status,
		).toBe("unknown");
		expect(
			(await capability.exec({ action: "shell", command: "again" })).status,
		).toBe("unknown");
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it("fences an uncertain shell until an explicit successful close", async () => {
		const { client, fetcher } = setup();
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockResolvedValueOnce(Response.json({ session_id: "uncertain-shell" }))
			.mockRejectedValueOnce(new Error("lost command acknowledgement"));
		await expect(
			client.exec(a, { action: "shell", command: "once" }),
		).rejects.toMatchObject({ ambiguous: true });
		await expect(
			client.exec(a, { action: "shell", command: "again" }),
		).rejects.toMatchObject({ ambiguous: true });
		expect(fetcher).toHaveBeenCalledTimes(3);
		fetcher.mockResolvedValueOnce(new Response());
		expect((await client.exec(a, { action: "close_shell" })).status).toBe("ok");
		expect(String(fetcher.mock.calls[3]?.[0])).toContain(
			"/session/uncertain-shell",
		);
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockResolvedValueOnce(Response.json({ session_id: "replacement-shell" }))
			.mockResolvedValueOnce(sse());
		expect(
			(await client.exec(a, { action: "shell", command: "new command" }))
				.status,
		).toBe("ok");
	});

	it("retains the command handle when output exceeds the cap without exposing a partial secret", async () => {
		const { client, fetcher } = setup();
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockResolvedValueOnce(sse("large-command", "x".repeat(32700) + token));
		const result = await client.exec(a, {
			action: "start",
			command: "large output",
		});
		expect(result).toMatchObject({ status: "unknown", truncated: true });
		expect(result.commandId).toBeTruthy();
		expect(result.output).not.toContain(token.slice(0, 8));
		fetcher.mockResolvedValueOnce(
			Response.json({ running: false, exit_code: 0 }),
		);
		expect(
			await client.exec(a, { action: "poll", commandId: result.commandId }),
		).toMatchObject({ status: "ok", running: false, exitCode: 0 });
		expect(String(fetcher.mock.calls[2]?.[0])).toContain(
			"/command/status/large-command",
		);
	});

	it("retains an observed init handle across stream failure without repeating the start", async () => {
		const { client, fetcher } = setup();
		let delivered = false;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (delivered) controller.error(new Error("lost stream"));
				else {
					delivered = true;
					controller.enqueue(
						new TextEncoder().encode(
							'data: {"type":"init","text":"lost-stream-command"}\n\n',
						),
					);
				}
			},
		});
		fetcher
			.mockResolvedValueOnce(new Response())
			.mockResolvedValueOnce(new Response(body));
		const result = await client.exec(a, { action: "start", command: "once" });
		expect(result.status).toBe("unknown");
		expect(result.commandId).toBeTruthy();
		expect(fetcher).toHaveBeenCalledTimes(2);
		fetcher.mockResolvedValueOnce(Response.json({ running: true }));
		expect(
			(await client.exec(a, { action: "poll", commandId: result.commandId }))
				.running,
		).toBe(true);
		expect(String(fetcher.mock.calls[2]?.[0])).toContain(
			"/command/status/lost-stream-command",
		);
	});

	it("polls and reads retained logs without repeating command content", async () => {
		const { client, fetcher } = setup();
		fetcher.mockResolvedValueOnce(new Response()).mockResolvedValueOnce(sse());
		const started = await client.exec(a, {
			action: "start",
			command: "printf proof",
		});
		fetcher.mockResolvedValueOnce(
			Response.json({
				running: false,
				exit_code: 7,
				content: "never return command metadata",
			}),
		);
		expect(
			await client.exec(a, { action: "poll", commandId: started.commandId }),
		).toMatchObject({ running: false, exitCode: 7, output: "" });
		fetcher.mockResolvedValueOnce(
			new Response("proof", { headers: { "EXECD-COMMANDS-TAIL-CURSOR": "2" } }),
		);
		expect(
			await client.exec(a, {
				action: "logs",
				commandId: started.commandId,
				cursor: 1,
			}),
		).toMatchObject({ output: "proof", cursor: 2 });
	});
});
