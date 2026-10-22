// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@cogni/ai-tools/tools/sandbox`
 * Purpose: Transport-free sandbox tool contracts; identity and credentials are injected.
 * Scope: Schemas and capability bindings only; no environment reads or network I/O.
 * Invariants: NO_MODEL_IDENTITY; NO_SECRETS_IN_CONTEXT; NO_AUTOMATIC_RETRY.
 * Side-effects: none
 * Links: docs/spec/tool-use.md, services/sandbox/README.md
 * @public
 */
import { z } from "zod";
import type { BoundTool, ToolContract } from "../types";

export const SANDBOX_EXEC_NAME = "core__sandbox_exec" as const;
export const SANDBOX_READ_FILE_NAME = "core__sandbox_read_file" as const;
export const SANDBOX_WRITE_FILE_NAME = "core__sandbox_write_file" as const;

export const SandboxExecInputSchema = z
	.object({
		action: z.enum(["start", "poll", "logs", "signal", "shell", "close_shell"]),
		command: z.string().min(1).max(16384).optional(),
		commandId: z.string().min(1).max(2048).optional(),
		timeoutMs: z.number().int().min(100).max(120000).optional(),
		cursor: z.number().int().min(0).optional(),
	})
	.strict();
export type SandboxExecInput = z.infer<typeof SandboxExecInputSchema>;

const relativePath = z
	.string()
	.min(1)
	.max(512)
	.refine(
		(p) =>
			!p.startsWith("/") &&
			!p.includes("\\") &&
			!p.includes("\0") &&
			p.split("/").every((part) => part !== ".." && part !== ""),
		"Use a relative path within this thread's workspace; traversal is forbidden.",
	);
export const SandboxReadFileInputSchema = z
	.object({ path: relativePath })
	.strict();
export const SandboxWriteFileInputSchema = z
	.object({
		path: relativePath,
		content: z.string().max(32768),
	})
	.strict();
export type SandboxReadFileInput = z.infer<typeof SandboxReadFileInputSchema>;
export type SandboxWriteFileInput = z.infer<typeof SandboxWriteFileInputSchema>;

export const SandboxOutputSchema = z.object({
	status: z.enum(["ok", "unavailable", "error", "unknown"]),
	output: z.string().max(32768),
	truncated: z.boolean(),
	commandId: z.string().optional(),
	running: z.boolean().optional(),
	exitCode: z.number().int().nullable().optional(),
	cursor: z.number().int().min(0).optional(),
	message: z.string().optional(),
});
export type SandboxOutput = z.infer<typeof SandboxOutputSchema>;

/** Identity, workspace, URL and token are NEVER model arguments. */
export interface SandboxCapability {
	exec(input: SandboxExecInput): Promise<SandboxOutput>;
	readFile(input: SandboxReadFileInput): Promise<SandboxOutput>;
	writeFile(input: SandboxWriteFileInput): Promise<SandboxOutput>;
}

export const unavailableSandboxCapability: SandboxCapability = {
	exec: async () => unavailable(),
	readFile: async () => unavailable(),
	writeFile: async () => unavailable(),
};
function unavailable(): SandboxOutput {
	return {
		status: "unavailable",
		output: "",
		truncated: false,
		message:
			"Sandbox execution is unavailable: shared caller authorization and containment are not configured.",
	};
}

function contract<N extends string, I>(
	name: N,
	description: string,
	inputSchema: z.ZodType<I>,
	effect: ToolContract<N, I, SandboxOutput, SandboxOutput>["effect"],
): ToolContract<N, I, SandboxOutput, SandboxOutput> {
	return {
		name,
		description,
		inputSchema,
		effect,
		outputSchema: SandboxOutputSchema,
		redact: (output) => output,
		allowlist: [
			"status",
			"output",
			"truncated",
			"commandId",
			"running",
			"exitCode",
			"cursor",
			"message",
		],
	};
}
export const sandboxExecContract = contract(
	SANDBOX_EXEC_NAME,
	"Use a trusted Red sandbox. start launches a bounded background command; poll/logs/signal use its opaque commandId. " +
		"shell runs a command in this thread's persistent shell; close_shell releases it. " +
		"Never retry a start or shell call whose status is unknown: it may already have executed. " +
		"Use only self-owned fixtures. Workspaces are directory-separated, not a security boundary; external target egress is not guaranteed.",
	SandboxExecInputSchema,
	"external_side_effect",
);
export const sandboxReadFileContract = contract(
	SANDBOX_READ_FILE_NAME,
	"Read a UTF-8 file relative to this authenticated thread's sandbox workspace. Output is bounded.",
	SandboxReadFileInputSchema,
	"read_only",
);
export const sandboxWriteFileContract = contract(
	SANDBOX_WRITE_FILE_NAME,
	"Write a UTF-8 file relative to this authenticated thread's sandbox workspace. Parent directories are created.",
	SandboxWriteFileInputSchema,
	"state_change",
);

export function createSandboxImplementations(capability: SandboxCapability) {
	return {
		[SANDBOX_EXEC_NAME]: {
			execute: (i: SandboxExecInput) => capability.exec(i),
		},
		[SANDBOX_READ_FILE_NAME]: {
			execute: (i: SandboxReadFileInput) => capability.readFile(i),
		},
		[SANDBOX_WRITE_FILE_NAME]: {
			execute: (i: SandboxWriteFileInput) => capability.writeFile(i),
		},
	};
}
export const sandboxExecBoundTool: BoundTool<
	typeof SANDBOX_EXEC_NAME,
	SandboxExecInput,
	SandboxOutput,
	SandboxOutput
> = {
	contract: sandboxExecContract,
	implementation: { execute: unavailableSandboxCapability.exec },
};
export const sandboxReadFileBoundTool: BoundTool<
	typeof SANDBOX_READ_FILE_NAME,
	SandboxReadFileInput,
	SandboxOutput,
	SandboxOutput
> = {
	contract: sandboxReadFileContract,
	implementation: { execute: unavailableSandboxCapability.readFile },
};
export const sandboxWriteFileBoundTool: BoundTool<
	typeof SANDBOX_WRITE_FILE_NAME,
	SandboxWriteFileInput,
	SandboxOutput,
	SandboxOutput
> = {
	contract: sandboxWriteFileContract,
	implementation: { execute: unavailableSandboxCapability.writeFile },
};
