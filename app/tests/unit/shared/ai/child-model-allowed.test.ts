// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/shared/ai/child-model-allowed`
 * Purpose: The `cogni` child model the shared provider allows (`isChildModelAllowed`) is in Red's model catalog, so a child `task` call is not refused.
 * Scope: Reads the child model id from the installed package, feeds a LiteLLM `/model/info` payload to Red's real catalog, and asks `isModelAllowed`. Red's catalog is the gateway's live list, not a file in this repo: a gateway without the model fails this check's second case, and the fix then belongs in the gateway config.
 * Invariants:
 *   - CHILD_MODEL_IN_CATALOG: the package's child model id is allowed when the gateway lists it
 *   - FAIL_CLOSED: a gateway that does not list it refuses it, which the provider reports as `cogni_child_model_not_authorized`
 * Side-effects: IO (reads the package's built entrypoint)
 * Links: https://node-template.cognidao.org/knowledge/inproc-provider-package-design
 * @internal
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/env/server", () => ({
	serverEnv: () => ({
		LITELLM_BASE_URL: "http://litellm.test",
		LITELLM_MASTER_KEY: "key",
	}),
}));

/** The model the package's `cogni` child agent calls, read from the installed package so the test follows the pin. */
function childModelId(): string {
	const pkg = resolve(process.cwd(), "../packages/langgraph-graphs/package.json");
	const entry = createRequire(pkg).resolve(
		"@cogni/shared-langgraph-graphs/inproc",
	);
	const found = /CHILD_MODEL_ID = "([^"]+)"/.exec(readFileSync(entry, "utf8"));
	if (!found?.[1])
		throw new Error(
			"CHILD_MODEL_ID not found in the package entrypoint: update this test to the package's new export",
		);
	return found[1];
}

function gatewayListing(ids: string[]) {
	return {
		data: ids.map((id) => ({ model_name: id, model_info: {} })),
	};
}

async function allowed(ids: string[], modelId: string) {
	vi.resetModules();
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(JSON.stringify(gatewayListing(ids)), { status: 200 }),
		),
	);
	const { isModelAllowed } = await import("@/shared/ai/model-catalog.server");
	return isModelAllowed(modelId);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("the cogni child model and Red's catalog", () => {
	it("allows the package's child model when the gateway lists it", async () => {
		const child = childModelId();
		expect(await allowed(["gpt-oss-120b", child], child)).toBe(true);
	});

	it("refuses it when the gateway does not list it", async () => {
		const child = childModelId();
		expect(await allowed(["gpt-oss-120b"], child)).toBe(false);
	});
});
