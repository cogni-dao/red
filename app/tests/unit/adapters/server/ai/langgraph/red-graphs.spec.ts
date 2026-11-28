// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/adapters/server/ai/langgraph/red-graphs`
 * Purpose: Red's own graphs keep working on the shared in-process provider (story.0090 item 5): the composed catalog, the red-solver principal and its scoped HTTP tool, and the shell audience.
 * Scope: Real catalog, real tool contracts, real package provider and runner; the model, the tool bodies and the grant store are fakes. Does NOT call an LLM or a network.
 * Invariants:
 *   - DISCOVERY_PROOF: the composed catalog lists exactly cogni, work-prioritizer and red-solver, and `cogni` advertises exactly those
 *   - RED_SOLVER_IS_GUARDED: red-solver runs as its seeded principal; its HTTP tool opens only for a live role row; the shell only on a claimed run by an audience caller
 * Side-effects: none
 * Links: https://node-template.cognidao.org/knowledge/inproc-provider-package-design
 * @internal
 */

import type { AiEvent } from "@cogni/ai-core";
import { CORE_TOOL_BUNDLE, toBoundToolRuntime } from "@cogni/ai-tools";
import { LANGGRAPH_CATALOG } from "@cogni/langgraph-graphs";
import { describe, expect, it, vi } from "vitest";

import { runInScope } from "@/adapters/server/ai/execution-scope";
import {
	type CompletionUnitAdapter,
	LangGraphInProcProvider,
} from "@/adapters/server/ai/langgraph/inproc.provider";
import type { ExecutionContext, GraphRunRequest } from "@/ports";

const AUDIENCE = "dfa8570f-d487-4239-b40a-2e39ee4513f9";
const HTTP = "core__http_request";
const SHELL = "core__sandbox_shell";

const SCOPE = {
	actorUserId: AUDIENCE,
	billing: { billingAccountId: "account", virtualKeyId: "key" },
	usageSource: "litellm" as const,
	llmService: {},
} as never;

describe("Red's composed catalog", () => {
	it("lists exactly cogni, work-prioritizer and red-solver", () => {
		expect(Object.keys(LANGGRAPH_CATALOG).sort()).toEqual([
			"cogni",
			"red-solver",
			"work-prioritizer",
		]);
	});

	it("advertises the same three graphs in the cogni prompt, and not work-closeout", () => {
		const prompt = LANGGRAPH_CATALOG.cogni?.systemPrompt ?? "";
		expect(prompt).toContain("langgraph:work-prioritizer");
		expect(prompt).toContain("langgraph:red-solver");
		expect(prompt).not.toContain("work-closeout");
	});

	it("keeps work-prioritizer read-only", () => {
		const entry = LANGGRAPH_CATALOG["work-prioritizer"];
		expect(entry?.toolIds).not.toContain("core__work_item_update");
		expect(entry?.toolIds).not.toContain("core__work_item_artifact_record");
		expect(entry?.systemPrompt).toContain("READ-ONLY ON THIS NODE");
	});

	it("names a principal for red-solver and declares a scope on its HTTP tool", () => {
		expect(LANGGRAPH_CATALOG["red-solver"]?.principal).toBe("red-solver");
		const contract = CORE_TOOL_BUNDLE.find(
			(tool) => tool.contract.name === HTTP,
		)?.contract;
		expect(contract?.requires).toMatchObject({
			scope: "red.http_request",
			kind: "node",
		});
	});
});

function runtimes() {
	const map = new Map(
		CORE_TOOL_BUNDLE.map((tool) => [tool.contract.name, toBoundToolRuntime(tool)]),
	);
	return {
		getBoundTool: (id: string) => map.get(id),
		listToolSpecs: () => [...map.values()].map((rt) => rt.spec),
		hasToolId: (id: string) => map.has(id),
	};
}

/** Runs `langgraph:red-solver` once and returns the tool names the model was offered, or the stream's error. */
async function runRedSolver(options: {
	seeded?: boolean;
	granted?: readonly string[];
	claimed?: boolean;
	actor?: string;
}) {
	const completion = {
		executeCompletionUnit: vi.fn(() => ({
			stream: (async function* () {})() as AsyncIterable<AiEvent>,
			final: Promise.resolve({
				ok: true as const,
				content: "done",
				finishReason: "stop",
			}),
		})),
	} as unknown as CompletionUnitAdapter & {
		executeCompletionUnit: ReturnType<typeof vi.fn>;
	};
	const granted = new Set(options.granted ?? []);
	const provider = new LangGraphInProcProvider({
		completion,
		tools: runtimes(),
		toolBundle: [...CORE_TOOL_BUNDLE],
		authority: {
			resolvePrincipal: async (slug: string) =>
				options.seeded === false ? null : `${slug}-principal`,
			guardDeps: {
				withStore: async (fn: (store: unknown) => unknown) =>
					fn({
						liveScopes: async (_principal: string, scopes: string[]) =>
							scopes.filter((scope) => granted.has(scope)),
						hasLiveRole: async (_principal: string, scope: string) =>
							granted.has(scope),
					}),
				adminCheck: async () => "denied" as const,
			},
		} as never,
		coding: {
			isCodingActor: (id) => id === AUDIENCE,
			prerequisitesReady: () => true,
		},
	});
	const req = {
		runId: "run",
		graphId: "langgraph:red-solver",
		messages: [{ role: "user", content: "solve it" }],
		modelRef: { providerKey: "platform", modelId: "model" },
	} as unknown as GraphRunRequest;
	const ctx = {
		actorUserId: options.actor ?? AUDIENCE,
		...(options.claimed ? { runClaimVerified: true as const } : {}),
	} as ExecutionContext;
	return runInScope(SCOPE, async () => {
		const run = provider.runGraph(req, ctx);
		const events: AiEvent[] = [];
		for await (const event of run.stream) events.push(event);
		const final = await run.final;
		const call = completion.executeCompletionUnit.mock.calls[0]?.[0] as
			| { tools?: { function: { name: string } }[] }
			| undefined;
		return {
			final,
			events,
			modelCalls: completion.executeCompletionUnit.mock.calls.length,
			offered: (call?.tools ?? []).map((tool) => tool.function.name),
		};
	});
}

describe("red-solver on the shared provider", () => {
	it("runs and offers the HTTP tool once its principal holds red.http_request", async () => {
		const result = await runRedSolver({ granted: ["red.http_request"] });
		expect(result.final.ok).toBe(true);
		expect(result.offered).toContain(HTTP);
	});

	it("withholds the shell from a run that carries no claim, and still runs", async () => {
		const result = await runRedSolver({
			granted: ["red.http_request", "sandbox:exec"],
		});
		expect(result.final.ok).toBe(true);
		expect(result.offered).toContain(HTTP);
		expect(result.offered).not.toContain(SHELL);
	});

	it("offers the shell on a claimed run by an audience caller whose principal holds sandbox:exec", async () => {
		const result = await runRedSolver({
			granted: ["red.http_request", "sandbox:exec"],
			claimed: true,
		});
		expect(result.final.ok).toBe(true);
		expect(result.offered).toEqual(expect.arrayContaining([HTTP, SHELL]));
	});

	it("withholds the shell from a claimed caller outside the audience", async () => {
		const result = await runRedSolver({
			granted: ["red.http_request", "sandbox:exec"],
			claimed: true,
			actor: "someone-else",
		});
		expect(result.final.ok).toBe(true);
		expect(result.offered).not.toContain(SHELL);
	});

	it("offers no HTTP tool while an admin has not turned the scope On", async () => {
		const result = await runRedSolver({ granted: [] });
		expect(result.offered).not.toContain(HTTP);
	});

	it("fails before the model when the red-solver principal is not seeded", async () => {
		const result = await runRedSolver({
			seeded: false,
			granted: ["red.http_request"],
		});
		expect(result.final.ok).toBe(false);
		expect(result.modelCalls).toBe(0);
	});
});
