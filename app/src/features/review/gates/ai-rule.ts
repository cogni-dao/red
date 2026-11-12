// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/** Legacy rule declarations fail closed after the Red graph cut (task.0013). */
import type { Rule } from "@cogni/repo-spec";
import type { GraphExecutorPort } from "@/ports";
import type { EvidenceBundle, GateResult } from "../types";

export async function evaluateAiRule(params: {
  readonly rule: Pick<Rule, "id">;
  readonly evidence: EvidenceBundle;
  readonly executor: GraphExecutorPort;
  readonly model: string;
}): Promise<GateResult> {
  return {
    gateId: params.rule.id,
    gateType: "ai-rule",
    status: "fail",
    summary: "Red no longer hosts the pr-review graph. Use the operator review workflow and remove this legacy ai-rule declaration.",
  };
}
