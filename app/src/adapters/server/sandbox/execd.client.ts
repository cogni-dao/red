// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@adapters/server/sandbox/execd.client`
 * Purpose: Bounded, authenticated OpenSandbox execd transport on the operator's separate lease.
 * Scope: Command/session/file protocol; never provisions infrastructure or retries commands.
 * Invariants: NO_AUTOMATIC_RETRY; SIGNED_COMMAND_OWNERSHIP; CREDENTIALS_SERVER_ONLY.
 * Side-effects: HTTP to the configured execd origin
 * Links: services/sandbox/README.md, OpenSandbox specs/execd-api.yaml release-1.1.1
 * @internal
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { posix } from "node:path";
import {
	type SandboxExecInput,
	SandboxExecInputSchema,
	type SandboxOutput,
	type SandboxReadFileInput,
	SandboxReadFileInputSchema,
	type SandboxWriteFileInput,
	SandboxWriteFileInputSchema,
} from "@cogni/ai-tools";
import { z } from "zod";

const MAX_BYTES = 32768;
const statusSchema = z.object({
	running: z.boolean(),
	exit_code: z.number().int().nullable().optional(),
});
const sessionSchema = z.object({ session_id: z.string().min(1).max(512) });
const eventSchema = z.object({ type: z.string(), text: z.string().optional() });
export class ExecdClientError extends Error {
	constructor(
		readonly reasonCode:
			| "auth"
			| "upstream"
			| "transport"
			| "protocol"
			| "scope"
			| "busy",
		readonly ambiguous = false,
	) {
		super(`Sandbox operation failed (${reasonCode}).`);
	}
}

export class ExecdClient {
	private readonly base: URL;
	private readonly shells = new Map<string, Promise<string>>();
	private readonly shellBusy = new Set<string>();
	constructor(
		private readonly options: {
			url: string;
			token: string;
			fetch?: typeof fetch;
		},
	) {
		this.base = new URL(options.url);
		if (
			this.base.username ||
			this.base.password ||
			this.base.search ||
			this.base.hash ||
			this.base.pathname !== "/" ||
			options.token.length < 32 ||
			(this.base.protocol !== "https:" &&
				!(
					this.base.protocol === "http:" &&
					["localhost", "127.0.0.1", "[::1]"].includes(this.base.hostname)
				))
		) {
			throw new Error("Invalid sandbox transport configuration.");
		}
	}

	private path(workspace: string, relative: string): string {
		if (!/^\/workspace\/[a-f0-9]{64}$/.test(workspace))
			throw new ExecdClientError("scope");
		const resolved = posix.resolve(workspace, relative);
		if (!resolved.startsWith(`${workspace}/`))
			throw new ExecdClientError("scope");
		return resolved;
	}
	private signature(workspace: string, payload: string): string {
		return createHmac("sha256", this.options.token)
			.update(`${workspace}\0${payload}`)
			.digest("base64url");
	}
	private handle(workspace: string, id: string): string {
		const payload = Buffer.from(
			JSON.stringify({ id, expires: Date.now() + 86400000 }),
		).toString("base64url");
		return `${payload}.${this.signature(workspace, payload)}`;
	}
	private commandId(workspace: string, handle: string | undefined): string {
		if (!handle || handle.length > 2048) throw new ExecdClientError("scope");
		const [payload, signature, extra] = handle.split(".");
		if (!payload || !signature || extra !== undefined)
			throw new ExecdClientError("scope");
		const expected = Buffer.from(this.signature(workspace, payload));
		const actual = Buffer.from(signature);
		if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
			throw new ExecdClientError("scope");
		try {
			const value = z
				.object({ id: z.string().min(1).max(512), expires: z.number() })
				.parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
			if (value.expires < Date.now()) throw new Error("expired");
			return value.id;
		} catch {
			throw new ExecdClientError("scope");
		}
	}
	private async request(
		path: string,
		init: RequestInit = {},
		timeoutMs = 10000,
		ambiguous = false,
	): Promise<Response> {
		const headers = new Headers(init.headers);
		headers.set("X-EXECD-ACCESS-TOKEN", this.options.token);
		try {
			const response = await (this.options.fetch ?? fetch)(
				new URL(path, this.base),
				{
					...init,
					headers,
					redirect: "error",
					signal: AbortSignal.timeout(timeoutMs),
				},
			);
			if (!response.ok) {
				await response.body?.cancel();
				throw new ExecdClientError(
					response.status === 401 || response.status === 403
						? "auth"
						: "upstream",
					ambiguous && response.status >= 500,
				);
			}
			return response;
		} catch (error) {
			if (error instanceof ExecdClientError) throw error;
			throw new ExecdClientError("transport", ambiguous);
		}
	}
	private async json(
		path: string,
		method: string,
		body: unknown,
		ambiguous = false,
	): Promise<unknown> {
		const response = await this.request(
			path,
			{
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			10000,
			ambiguous,
		);
		const result = await this.read(response);
		if (result.truncated) throw new ExecdClientError("protocol", ambiguous);
		try {
			return JSON.parse(result.text);
		} catch {
			throw new ExecdClientError("protocol", ambiguous);
		}
	}
	private async read(
		response: Response,
	): Promise<{ text: string; truncated: boolean }> {
		if (!response.body) return { text: "", truncated: false };
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let length = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				length += value.length;
				if (length > MAX_BYTES) {
					await reader.cancel();
					return {
						text: "[output limit reached; narrow the command or file]",
						truncated: true,
					};
				}
				chunks.push(value);
			}
		} catch {
			throw new ExecdClientError("transport", true);
		}
		const text = Buffer.concat(chunks).toString("utf8");
		return { text, truncated: false };
	}
	private safe(text: string): string {
		const clean = text
			.split(this.options.token)
			.join("[redacted]")
			.split(this.base.origin)
			.join("[sandbox]");
		if (
			/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|(?:password|api[_-]?key|access[_-]?token)\s*[=:]\s*\S+/i.test(
				clean,
			)
		) {
			return "[sensitive output withheld; stop and report]";
		}
		return clean;
	}
	private async mkdir(path: string): Promise<void> {
		const response = await this.request("/directories", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ [path]: { mode: 700 } }),
		});
		await response.body?.cancel();
	}
	private async stream(
		path: string,
		body: unknown,
		timeoutMs: number,
		workspace: string,
	): Promise<SandboxOutput> {
		const response = await this.request(
			path,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			timeoutMs + 2000,
			true,
		);
		const result = await this.read(response);
		if (result.truncated)
			return {
				status: "unknown",
				output: result.text,
				truncated: true,
				message: "Execution may have occurred. Do not retry the command.",
			};
		let id: string | undefined;
		let complete = false;
		let failed = false;
		const output: string[] = [];
		try {
			for (const line of result.text.split(/\r?\n/)) {
				// execd release-1.1.1 emits JSON records separated by blank lines;
				// accept standard SSE data framing as well, without treating a ping
				// or arbitrary HTTP body as an execution acknowledgement.
				const record = line.startsWith("data:")
					? line.slice(5).trim()
					: line.trim();
				if (!record.startsWith("{")) continue;
				const event = eventSchema.parse(JSON.parse(record));
				if (event.type === "init") id = event.text;
				if (event.type === "stdout" || event.type === "stderr")
					output.push(event.text ?? "");
				if (event.type === "execution_complete") complete = true;
				if (event.type === "error") failed = true;
			}
		} catch {
			throw new ExecdClientError("protocol", true);
		}
		if ((!complete || (path === "/command" && !id)) && !failed)
			throw new ExecdClientError("protocol", true);
		return {
			status: failed ? "error" : "ok",
			output: this.safe(output.join("")),
			truncated: false,
			...(id && path === "/command"
				? { commandId: this.handle(workspace, id) }
				: {}),
			...(failed
				? { message: "Sandbox command failed; inspect bounded logs." }
				: {}),
		};
	}

	async exec(workspace: string, raw: SandboxExecInput): Promise<SandboxOutput> {
		const input = SandboxExecInputSchema.parse(raw);
		// Validate the trusted workspace even for command-handle operations.
		this.path(workspace, "check");
		if (input.action === "start" || input.action === "shell") {
			if (!input.command) throw new ExecdClientError("scope");
			await this.mkdir(workspace);
			const timeout = input.timeoutMs ?? 30000;
			if (input.action === "start")
				return this.stream(
					"/command",
					{
						command: input.command,
						cwd: workspace,
						background: true,
						timeout,
					},
					timeout,
					workspace,
				);
			if (this.shellBusy.has(workspace)) throw new ExecdClientError("busy");
			this.shellBusy.add(workspace);
			try {
				let shell = this.shells.get(workspace);
				if (!shell) {
					if (this.shells.size >= 64) throw new ExecdClientError("busy");
					shell = this.json("/session", "POST", { cwd: workspace }, true).then(
						(v) => sessionSchema.parse(v).session_id,
					);
					this.shells.set(workspace, shell);
				}
				const id = await shell;
				return await this.stream(
					`/session/${encodeURIComponent(id)}/run`,
					{ command: input.command, timeout },
					timeout,
					workspace,
				);
			} finally {
				this.shellBusy.delete(workspace);
			}
		}
		if (input.action === "close_shell") {
			if (this.shellBusy.has(workspace)) throw new ExecdClientError("busy");
			this.shellBusy.add(workspace);
			try {
				const shell = this.shells.get(workspace);
				if (shell) {
					let id: string;
					try {
						id = await shell;
					} catch {
						// Explicit close releases a failed local allocation. Its upstream
						// identity is unknown, so never claim that an orphan was cleaned up.
						this.shells.delete(workspace);
						throw new ExecdClientError("protocol", true);
					}
					const response = await this.request(
						`/session/${encodeURIComponent(id)}`,
						{ method: "DELETE" },
						10000,
						true,
					);
					await response.body?.cancel();
					this.shells.delete(workspace);
				}
				return { status: "ok", output: "", truncated: false };
			} finally {
				this.shellBusy.delete(workspace);
			}
		}
		const id = encodeURIComponent(this.commandId(workspace, input.commandId));
		if (input.action === "signal") {
			const response = await this.request(
				`/command?id=${id}`,
				{ method: "DELETE" },
				10000,
				true,
			);
			await response.body?.cancel();
			return { status: "ok", output: "", truncated: false };
		}
		if (input.action === "poll") {
			const response = await this.request(`/command/status/${id}`);
			const data = await this.read(response);
			if (data.truncated) throw new ExecdClientError("protocol");
			const parsed = statusSchema.safeParse(JSON.parse(data.text));
			if (!parsed.success) throw new ExecdClientError("protocol");
			return {
				status: "ok",
				output: "",
				truncated: false,
				running: parsed.data.running,
				exitCode: parsed.data.exit_code ?? null,
			};
		}
		const response = await this.request(
			`/command/${id}/logs${input.cursor === undefined ? "" : `?cursor=${input.cursor}`}`,
		);
		const result = await this.read(response);
		const cursor = Number(response.headers.get("EXECD-COMMANDS-TAIL-CURSOR"));
		return {
			status: "ok",
			output: this.safe(result.text),
			truncated: result.truncated,
			...(Number.isSafeInteger(cursor) && cursor >= 0 ? { cursor } : {}),
		};
	}
	async readFile(
		workspace: string,
		raw: SandboxReadFileInput,
	): Promise<SandboxOutput> {
		const input = SandboxReadFileInputSchema.parse(raw);
		const path = this.path(workspace, input.path);
		const response = await this.request(
			`/files/download?path=${encodeURIComponent(path)}`,
			{ headers: { Range: `bytes=0-${MAX_BYTES}` } },
		);
		const result = await this.read(response);
		return {
			status: "ok",
			output: this.safe(result.text),
			truncated: result.truncated,
		};
	}
	async writeFile(
		workspace: string,
		raw: SandboxWriteFileInput,
	): Promise<SandboxOutput> {
		const input = SandboxWriteFileInputSchema.parse(raw);
		if (Buffer.byteLength(input.content) > MAX_BYTES)
			throw new ExecdClientError("scope");
		const path = this.path(workspace, input.path);
		await this.mkdir(posix.dirname(path));
		const form = new FormData();
		form.append(
			"metadata",
			new Blob([JSON.stringify({ path, mode: 600 })], {
				type: "application/json",
			}),
			"metadata.json",
		);
		form.append(
			"file",
			new Blob([input.content], { type: "text/plain" }),
			"workspace-file",
		);
		const response = await this.request(
			"/files/upload",
			{ method: "POST", body: form },
			10000,
			true,
		);
		await response.body?.cancel();
		return { status: "ok", output: "", truncated: false };
	}
}
