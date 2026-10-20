// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO
/**
 * Purpose: Prove versioned sandbox authorization cannot leak across deployment lanes.
 * Scope: Bootstrap policy reader using isolated temporary configuration.
 * Invariants: UNKNOWN_LANE_DENIED; INVALID_POLICY_FAILS_CLOSED.
 * Side-effects: Temporary fixture files, removed after each test.
 * @internal
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSandboxAllowedActors } from "@/bootstrap/capabilities/sandbox-policy";

const actor = "00000000-0000-4000-8000-000000000001";
const roots: string[] = [];
function fixture(policy: unknown): string {
	const root = mkdtempSync(join(tmpdir(), "red-sandbox-policy-"));
	roots.push(root);
	mkdirSync(join(root, ".cogni"));
	writeFileSync(
		join(root, ".cogni/sandbox-policy.json"),
		JSON.stringify(policy),
	);
	return root;
}
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
describe("sandbox actor policy", () => {
	it("does not grant candidate identities access in other lanes", () => {
		const root = fixture({ "candidate-a": [actor] });
		expect(loadSandboxAllowedActors(root, "candidate-a")).toEqual([actor]);
		for (const lane of ["preview", "production", "unknown", undefined])
			expect(loadSandboxAllowedActors(root, lane)).toEqual([]);
	});
	it("denies missing configuration", () => {
		const root = fixture({});
		rmSync(join(root, ".cogni/sandbox-policy.json"));
		expect(loadSandboxAllowedActors(root, "candidate-a")).toEqual([]);
		expect(loadSandboxAllowedActors(undefined, "candidate-a")).toEqual([]);
	});
	it("rejects malformed identities and unexpected policy fields", () => {
		for (const policy of [
			{ "candidate-a": ["not-an-actor-id"] },
			{ "candidate-a": [actor], wildcard: [actor] },
		]) {
			expect(() =>
				loadSandboxAllowedActors(fixture(policy), "candidate-a"),
			).toThrow("Invalid sandbox actor policy");
		}
	});
});
