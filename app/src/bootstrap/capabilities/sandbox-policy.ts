// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO
/**
 * Module: sandbox-policy
 * Purpose: Load Red's versioned, non-secret actor authorization by deployment lane.
 * Scope: Bootstrap-only node policy; no environment override for actor membership.
 * Invariants: UNKNOWN_LANE_DENIED; INVALID_POLICY_FAILS_CLOSED.
 * Side-effects: Reads the packaged .cogni/sandbox-policy.json once at bootstrap.
 * @internal
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const policySchema = z
	.object({
		"candidate-a": z.array(z.string().uuid()).default([]),
		preview: z.array(z.string().uuid()).default([]),
		production: z.array(z.string().uuid()).default([]),
	})
	.strict();

export function loadSandboxAllowedActors(
	repoRoot: string | undefined,
	lane: string | undefined,
): readonly string[] {
	if (
		!repoRoot ||
		!lane ||
		!["candidate-a", "preview", "production"].includes(lane)
	)
		return [];
	const file = join(repoRoot, ".cogni", "sandbox-policy.json");
	let raw: string;
	try {
		raw = readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw new Error("Cannot read sandbox actor policy");
	}
	const parsed = policySchema.safeParse(JSON.parse(raw));
	if (!parsed.success) throw new Error("Invalid sandbox actor policy");
	return parsed.data[lane as keyof typeof parsed.data];
}
