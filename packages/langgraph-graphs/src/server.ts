// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseRepoSpec, extractNodeMission } from "@cogni/repo-spec";
import { NODE_LANGGRAPH_CATALOG } from "@cogni/shared-langgraph-graphs";
import { makeServerGraph } from "./runtime/core/make-server-graph";

// LangGraph API calls these factories per run, then injects its checkpointer and store.
// Host provenance belongs to this dev entrypoint, never to a graph or model input.
const spec = parseRepoSpec(readFileSync(resolve(process.env.COGNI_REPO_PATH ?? "../..", ".cogni/repo-spec.yaml"), "utf8"));
const sourceContext = {
  nodeId: spec.node_id,
  origin: process.env.APP_BASE_URL ?? "http://localhost:3000",
  mission: { content: extractNodeMission(spec) ?? "", sourceRef: ".cogni/repo-spec.yaml", buildSha: process.env.COGNI_REPO_SHA ?? null },
};
const cogniEntry = NODE_LANGGRAPH_CATALOG.cogni;
const prioritizerEntry = NODE_LANGGRAPH_CATALOG["work-prioritizer"];

export const cogni = async () => makeServerGraph({ name: "cogni", createGraph: cogniEntry.graphFactory, toolIds: cogniEntry.toolIds, program: "cogni", sourceContext, ...(cogniEntry.systemPrompt !== undefined && {systemPrompt: cogniEntry.systemPrompt}) });
export const workPrioritizer = async () => makeServerGraph({ name: "work-prioritizer", createGraph: prioritizerEntry.graphFactory, toolIds: prioritizerEntry.toolIds, program: "work-review", sourceContext, ...(prioritizerEntry.systemPrompt !== undefined && {systemPrompt: prioritizerEntry.systemPrompt}) });
