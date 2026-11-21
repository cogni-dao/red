// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	options: undefined as any,
	sandbox: 0,
	mint: 0,
	live: true,
	failure: "" as string,
	legacy: 0,
	identity: undefined as unknown,
}));
const ingress = vi.hoisted(() => ({
	headers: new Headers(),
	cookieUser: null as null | {
		id: string;
		walletAddress: null;
		displayName: null;
		avatarColor: null;
	},
}));
vi.mock("next/headers", () => ({ headers: async () => ingress.headers }));
vi.mock("@/lib/auth/server", () => ({
	getServerSessionUser: async () => ingress.cookieUser,
}));
vi.mock("@/shared/env/server", () => ({
	serverEnv: () => ({ AUTH_SECRET: "test-secret-123456789012345678901234" }),
}));
vi.mock("@cogni/langgraph-graphs", () => {
	const cogni = {
		displayName: "Cogni",
		description: "Shared",
		sharedRuntime: true,
		toolIds: ["core__sandbox_shell"],
		graphFactory: () => ({}),
		principal: "node-ai",
		program: "cogni",
	};
	return {
		LANGGRAPH_CATALOG: {
			cogni,
			poet: {
				displayName: "Poet",
				description: "legacy",
				toolIds: [],
				graphFactory: () => ({}),
			},
		},
		SHARED_NODE_CATALOG: { cogni },
		createInProcGraphRunner: () => {
			state.legacy++;
			return {
				stream: (async function* () {
					yield { type: "done" };
				})(),
				final: Promise.resolve({ ok: true }),
			};
		},
		createSharedInProcGraphRunner: (options: any) => {
			state.options = options;
			options.completionFn({ messages: [], model: "model" });
			return {
				stream: (async function* () {
					yield { type: "done" };
				})(),
				final: Promise.resolve({ ok: true, content: "ok" }),
			};
		},
	};
});
vi.mock("@/shared/observability", () => ({
	EVENT_NAMES: {},
	makeLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}));

import { aiChatOperation } from "@cogni/node-contracts";
import {
	getExecutionScope,
	runInScope,
} from "@/adapters/server/ai/execution-scope";
import { createLangGraphDispatch } from "@/adapters/server/ai/langgraph/dispatch";
import { LangGraphInProcProvider } from "@/adapters/server/ai/langgraph/inproc.provider";
import {
	issueAgentApiKey,
	resolveRequestIdentity,
} from "@/app/_lib/auth/request-identity";
import { signChatActor, verifyChatActor } from "@/bootstrap/chat-actor-proof";

const shell = "core__sandbox_shell";
const actor = "dfa8570f-d487-4239-b40a-2e39ee4513f9";
const contract = {
	name: shell,
	requires: { scope: "sandbox:exec", kind: "node", subject: "member" },
};
const runtime = {
	id: shell,
	effect: "external_side_effect",
	spec: {
		name: shell,
		effect: "external_side_effect",
		redaction: { mode: "top_level_only", allowlist: ["ok"] },
	},
	validateInput: (x: unknown) => x,
	validateOutput: (x: unknown) => x,
	exec: async () => {
		state.identity = getExecutionScope();
		state.sandbox++;
		state.mint++;
		return { ok: true };
	},
	redact: (x: unknown) => x,
};
const store = {
	liveScopes: async () => (state.live ? ["sandbox:exec"] : []),
	hasLiveRole: async () => state.live,
};
const deps = {
	resolvePrincipal: async () =>
		state.failure === "principal" ? null : "program-principal",
	guardDeps: {
		withStore: async (fn: any) => {
			if (state.failure === "store") throw new Error("unavailable");
			return fn(store);
		},
		adminCheck: async () => "denied" as const,
	},
	sourceContext: async () => {
		if (state.failure === "overflow")
			throw new Error("governing_index_overflow");
		return {
			nodeId: "red",
			origin: "https://red.cognidao.org",
			mission: { content: "red" },
			governingIndex: [],
		};
	},
	isCodingActor: (id: string) => id === actor,
	sandboxReady: () => state.failure !== "sandbox",
};
const req = {
	runId: "run",
	graphId: "langgraph:cogni",
	messages: [{ role: "user", content: "hello" }],
	modelRef: { providerKey: "platform", modelId: "model" },
};
const adapter = {
	executeCompletionUnit: vi.fn(() => ({
		stream: (async function* () {})(),
		final: Promise.resolve({ ok: true, content: "" }),
	})),
};
const source = {
	getBoundTool: (id: string) => (id === shell ? runtime : undefined),
	listToolSpecs: () => [runtime.spec],
	hasToolId: (id: string) => id === shell,
};
async function launch(user: string, extra: Record<string, unknown> = {}) {
	const scope = {
		actorUserId: user,
		billing: { billingAccountId: "account", virtualKeyId: "key" },
		usageSource: "litellm",
		llmService: {},
	} as any;
	const provider = new LangGraphInProcProvider(
		adapter as any,
		source as any,
		async () => null,
		[{ contract } as any],
		deps as any,
	);
	return runInScope(scope, async () => {
		const run = provider.runGraph(
			{ ...req, ...extra } as any,
			{ actorUserId: user } as any,
		);
		await run.final;
		return state.options;
	});
}
beforeEach(() => {
	state.options = undefined;
	state.sandbox = 0;
	state.mint = 0;
	state.live = true;
	state.failure = "";
	state.legacy = 0;
	state.identity = undefined;
	adapter.executeCompletionUnit.mockClear();
});
describe("shared Cogni authority seam", () => {
	it("carries trusted source and program and executes an allowed shell", async () => {
		const opts = await launch(actor);
		expect(adapter.executeCompletionUnit).toHaveBeenCalledOnce();
		expect(opts.trustedActorId).toBe(actor);
		expect(opts.trustedProgramId).toBe("cogni");
		expect(opts.sourceContext.nodeId).toBe("red");
		const result = await runInScope(
			{
				actorUserId: actor,
				billing: { billingAccountId: "account", virtualKeyId: "key" },
				usageSource: "litellm",
				llmService: {},
			} as any,
			() => opts.createToolExecFn(() => {})(shell, {}),
		);
		expect(result.ok).toBe(true);
		expect(state.sandbox).toBe(1);
		expect(state.mint).toBe(1);
		expect(state.identity).toMatchObject({
			actorUserId: actor,
			subjectUserId: actor,
			principalId: "program-principal",
			billing: { billingAccountId: "account" },
		});
	});
	it("withholds shell and denies a forced call for another actor despite spoofed request data", async () => {
		const opts = await launch("other", { actorUserId: actor });
		expect(opts.request.configurable.toolIds).not.toContain(shell);
		const result = await opts.createToolExecFn(() => {})(shell, {});
		expect(result.errorCode).toBe("policy_denied");
		expect(state.sandbox).toBe(0);
		expect(state.mint).toBe(0);
	});
	it("honors revocation between offering and execution", async () => {
		const opts = await launch(actor);
		expect(opts.request.configurable.toolIds).toContain(shell);
		state.live = false;
		const result = await opts.createToolExecFn(() => {})(shell, {});
		expect(result.ok).toBe(false);
		expect(state.sandbox).toBe(0);
		expect(state.mint).toBe(0);
	});
	it("keeps legacy graphs on the legacy runner", async () => {
		const scope = {
			actorUserId: actor,
			billing: { billingAccountId: "account", virtualKeyId: "key" },
			usageSource: "litellm",
			llmService: {},
		} as any;
		const provider = new LangGraphInProcProvider(adapter as any, source as any);
		await runInScope(scope, async () => {
			await provider.runGraph({ ...req, graphId: "langgraph:poet" } as any, {
				actorUserId: actor,
			}).final;
		});
		expect(state.legacy).toBe(1);
		expect(state.options).toBeUndefined();
	});
	it.each(["principal", "store", "sandbox", "overflow"])(
		"fails before effects when %s is unavailable",
		async (failure) => {
			state.failure = failure;
			expect(await launch(actor)).toBeUndefined();
			expect(adapter.executeCompletionUnit).not.toHaveBeenCalled();
			expect(state.sandbox).toBe(0);
			expect(state.mint).toBe(0);
		},
	);
	it("fails before the model when the coding grant is missing", async () => {
		state.live = false;
		const opts = await launch(actor);
		expect(opts).toBeUndefined();
		expect(adapter.executeCompletionUnit).not.toHaveBeenCalled();
	});
});

describe("trusted chat workflow identity", () => {
	const identity = {
		nodeId: "red",
		lane: "candidate",
		idempotencyKey: "claim",
		transportKey: "api:run",
		requestHash: "hash",
		runId: "run",
		graphId: "langgraph:cogni",
		actorUserId: actor,
		billingAccountId: "account",
		virtualKeyId: "key",
		payload: { messages: ["original"] },
	};
	it("accepts authenticated launcher proof and rejects actor or run spoofing", () => {
		const proof = signChatActor(identity, "test-secret");
		expect(verifyChatActor(identity, "test-secret", proof)).toBe(true);
		expect(
			verifyChatActor(
				{ ...identity, idempotencyKey: "other" },
				"test-secret",
				proof,
			),
		).toBe(false);
		expect(
			verifyChatActor(
				{ ...identity, requestHash: "other" },
				"test-secret",
				proof,
			),
		).toBe(false);
		expect(
			verifyChatActor({ ...identity, lane: "other" }, "test-secret", proof),
		).toBe(false);
		expect(
			verifyChatActor(
				{ ...identity, actorUserId: "other" },
				"test-secret",
				proof,
			),
		).toBe(false);
		expect(
			verifyChatActor({ ...identity, runId: "other" }, "test-secret", proof),
		).toBe(false);
		expect(
			verifyChatActor(
				{ ...identity, payload: { messages: ["altered"] } },
				"test-secret",
				proof,
			),
		).toBe(false);
		expect(verifyChatActor(identity, "test-secret", undefined)).toBe(false);
	});
});

describe("development namespace composition", () => {
	it("routes Cogni in-process and legacy graphs to dev", () => {
		const inproc = { runGraph: vi.fn() };
		const dev = { runGraph: vi.fn() };
		const router = createLangGraphDispatch(inproc as any, dev as any);
		router.runGraph({ graphId: "langgraph:cogni" } as any);
		router.runGraph({ graphId: "langgraph:brain" } as any);
		expect(inproc.runGraph).toHaveBeenCalledOnce();
		expect(dev.runGraph).toHaveBeenCalledOnce();
	});
});

describe("chat ingress identity", () => {
	it("resolves cookie and bearer from their authenticated sources and strips JSON identity claims", async () => {
		ingress.cookieUser = {
			id: actor,
			walletAddress: null,
			displayName: null,
			avatarColor: null,
		};
		ingress.headers = new Headers();
		expect((await resolveRequestIdentity())?.id).toBe(actor);
		const token = issueAgentApiKey({ userId: actor, displayName: null });
		ingress.headers = new Headers({ authorization: `Bearer ${token}` });
		expect((await resolveRequestIdentity())?.id).toBe(actor);
		const parsed = aiChatOperation.input.parse({
			message: "hello",
			graphName: "langgraph:cogni",
			modelRef: { providerKey: "platform", modelId: "model" },
			actorUserId: "attacker",
			program: "attacker",
			codingActorIds: ["attacker"],
		});
		expect(parsed).not.toHaveProperty("actorUserId");
		expect(parsed).not.toHaveProperty("program");
		expect(parsed).not.toHaveProperty("codingActorIds");
	});
});
