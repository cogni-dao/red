// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseRepoSpec, extractNodeMission } from "@cogni/repo-spec";
import { createCogniGraph, createWorkPrioritizerGraph } from "@cogni/shared-langgraph-graphs/graphs";
import { LANGGRAPH_CATALOG } from "./catalog";
import { makeServerGraph } from "./runtime/core/make-server-graph";

// Host provenance belongs to this dev entrypoint, never to a graph or model input.
const spec = parseRepoSpec(readFileSync(resolve(process.env.COGNI_REPO_PATH ?? "../..", ".cogni/repo-spec.yaml"), "utf8"));
const sourceContext = {
  nodeId: spec.node_id,
  origin: process.env.APP_BASE_URL ?? "http://localhost:3000",
  mission: { content: extractNodeMission(spec) ?? "", sourceRef: ".cogni/repo-spec.yaml", buildSha: process.env.COGNI_REPO_SHA ?? null },
};
const cogniEntry = LANGGRAPH_CATALOG.cogni!;
const prioritizerEntry = LANGGRAPH_CATALOG["work-prioritizer"]!;

export const cogni = await makeServerGraph({ name: "cogni", createGraph: createCogniGraph, toolIds: cogniEntry.toolIds, program: "cogni", sourceContext, ...(cogniEntry.systemPrompt !== undefined && {systemPrompt: cogniEntry.systemPrompt}) });
export const workPrioritizer = await makeServerGraph({ name: "work-prioritizer", createGraph: createWorkPrioritizerGraph, toolIds: prioritizerEntry.toolIds, program: "work-review", sourceContext, ...(prioritizerEntry.systemPrompt !== undefined && {systemPrompt: prioritizerEntry.systemPrompt}) });
