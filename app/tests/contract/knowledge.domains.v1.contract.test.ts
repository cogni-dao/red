// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/contract/knowledge.domains.v1.contract`
 * Purpose: Pin the wire shape of the knowledge domain operations — get, update, delete — and their typed error body.
 * Scope: Pure Zod schema validation. Does not test HTTP transport, auth, or storage.
 * Invariants: DOMAIN_ID_IS_IMMUTABLE (strict update body), DOMAIN_ERRORS_ARE_TYPED, CONTRACTS_ARE_TRUTH.
 * Side-effects: none
 * Links: packages/node-contracts/src/knowledge.domains.v1.contract.ts
 * @internal
 */

import { describe, expect, it } from "vitest";
import {
  DomainSchema,
  DomainsCreateResponseSchema,
  DomainsErrorCodeSchema,
  DomainsErrorResponseSchema,
  DomainsUpdateBodySchema,
  domainsDeleteOperation,
  domainsGetOperation,
  domainsUpdateOperation,
} from "../../../packages/node-contracts/src/knowledge.domains.v1.contract";

const DOMAIN = {
  id: "build-evals",
  name: "build-evals",
  description: "probe",
  confidencePct: 40,
  entryCount: 2,
  createdAt: "2026-10-29T19:39:03.367Z",
};

describe("domain item operations", () => {
  it("get returns the shared DomainSchema (create and get cannot drift)", () => {
    expect(domainsGetOperation.output).toBe(DomainSchema);
    expect(DomainsCreateResponseSchema).toBe(DomainSchema);
    expect(domainsUpdateOperation.output).toBe(DomainSchema);
    expect(domainsGetOperation.output.safeParse(DOMAIN).success).toBe(true);
  });

  it("rejects a malformed domain id in every operation input", () => {
    for (const op of [domainsGetOperation, domainsDeleteOperation]) {
      expect(op.input.safeParse({ domain: "Bad Id" }).success).toBe(false);
      expect(op.input.safeParse({ domain: "x" }).success).toBe(false);
      expect(op.input.safeParse({ domain: "ok-id_1" }).success).toBe(true);
    }
  });

  it("update body: partial, null clears, empty and unknown keys fail", () => {
    expect(DomainsUpdateBodySchema.safeParse({ name: "New" }).success).toBe(
      true
    );
    expect(
      DomainsUpdateBodySchema.safeParse({ description: "fixed" }).success
    ).toBe(true);
    const cleared = DomainsUpdateBodySchema.safeParse({ description: null });
    expect(cleared.success && cleared.data.description).toBeNull();
    // At least one field.
    expect(DomainsUpdateBodySchema.safeParse({}).success).toBe(false);
    // Strict: id and domain can never ride in the body (DOMAIN_ID_IS_IMMUTABLE).
    expect(
      DomainsUpdateBodySchema.safeParse({ id: "other", name: "x" }).success
    ).toBe(false);
    expect(
      DomainsUpdateBodySchema.safeParse({ domain: "other", name: "x" }).success
    ).toBe(false);
    // Bounds mirror create.
    expect(DomainsUpdateBodySchema.safeParse({ name: "" }).success).toBe(false);
    expect(
      DomainsUpdateBodySchema.safeParse({ name: "n".repeat(129) }).success
    ).toBe(false);
    expect(
      DomainsUpdateBodySchema.safeParse({ description: "d".repeat(513) })
        .success
    ).toBe(false);
  });

  it("update input pairs the path domain with the strict body", () => {
    expect(
      domainsUpdateOperation.input.safeParse({
        domain: "build-evals",
        body: { description: "Eval harness and scorecards" },
      }).success
    ).toBe(true);
    expect(
      domainsUpdateOperation.input.safeParse({
        domain: "build-evals",
        body: {},
      }).success
    ).toBe(false);
  });

  it("delete output is a literal deleted:true receipt", () => {
    expect(
      domainsDeleteOperation.output.safeParse({ id: "x1", deleted: true })
        .success
    ).toBe(true);
    expect(
      domainsDeleteOperation.output.safeParse({ id: "x1", deleted: false })
        .success
    ).toBe(false);
  });
});

describe("DomainsErrorResponseSchema", () => {
  it("accepts every code with its typed detail", () => {
    const bodies = [
      { error: "x", errorCode: "domain_not_found" },
      { error: "x", errorCode: "domain_not_empty", entryCount: 2 },
      { error: "x", errorCode: "domain_protected" },
      { error: "x", errorCode: "invalid_input", issues: [{ path: ["name"] }] },
      { error: "x", errorCode: "unauthorized" },
      { error: "x", errorCode: "invalid_json" },
      { error: "x", errorCode: "store_not_configured" },
      {
        error: "x",
        errorCode: "knowledge_write_outcome_unknown",
        retryable: false,
        operationId: "op",
        branch: "b",
        commitHash: null,
      },
      {
        error: "x",
        errorCode: "knowledge_write_scope_required",
        retryable: false,
      },
      {
        error: "x",
        errorCode: "knowledge_write_conflict",
        retryable: false,
        entryId: "e",
      },
      { error: "x", errorCode: "knowledge_busy", retryable: true },
    ];
    for (const b of bodies)
      expect(DomainsErrorResponseSchema.safeParse(b).success).toBe(true);
    // Every enum member is exercised above: adding a code fails this test until covered.
    expect(new Set(bodies.map((b) => b.errorCode))).toEqual(
      new Set(DomainsErrorCodeSchema.options)
    );
  });

  it("requires codes for domain errors and rejects unrecognized auth shapes", () => {
    for (const body of [
      { error: "domain not found" },
      { error: "unauthorized" },
      { error: "Unauthorized", errorCode: "nope" },
      { error: "Session required", retryable: true },
    ])
      expect(DomainsErrorResponseSchema.safeParse(body).success).toBe(false);
  });

  it("accepts only exact shared infrastructure error shapes", () => {
    for (const body of [
      {
        status: "error",
        reason: "CONTAINER_INIT_FAILED",
        message: "unavailable",
      },
      { error: "Internal server error" },
    ]) {
      expect(DomainsErrorResponseSchema.parse(body)).toEqual(body);
    }
    for (const body of [
      { status: "error", reason: "OTHER", message: "unavailable" },
      { status: "error", reason: "CONTAINER_INIT_FAILED" },
      { status: "error", reason: "CONTAINER_INIT_FAILED", message: 123 },
      {
        status: "error",
        reason: "CONTAINER_INIT_FAILED",
        message: "x",
        extra: true,
      },
      { error: "Internal server error", errorCode: "nope" },
      { error: "Internal server error", retryable: true },
      { error: "internal server error" },
    ]) {
      expect(DomainsErrorResponseSchema.safeParse(body).success).toBe(false);
    }
  });

  it("rejects an unknown code", () => {
    expect(
      DomainsErrorResponseSchema.safeParse({ error: "x", errorCode: "nope" })
        .success
    ).toBe(false);
  });
});

import {
  createKnowledgeReadImplementation,
  createKnowledgeSearchImplementation,
  createWorkItemQueryImplementation,
  type KnowledgeCapability,
  type WorkItemCapability,
} from "@cogni/shared-ai-tools";
// Consumer conformance uses actual release imports, never a copied shared implementation.
// These examples intentionally await immutable release installation before execution.
import { toWorkItemDto, toWorkItemId, type WorkItem } from "@cogni/work-items";
import { getToolById } from "../../../packages/ai-tools/src/catalog";
import { toToolSpec } from "../../../packages/ai-tools/src/schema";
import { knowledgeReadContract } from "../../../packages/ai-tools/src/tools/knowledge-read";
import { knowledgeSearchContract } from "../../../packages/ai-tools/src/tools/knowledge-search";
import { workItemQueryContract } from "../../../packages/ai-tools/src/tools/work-item-query";
import { makeLangChainTool } from "../../../packages/langgraph-graphs/src/runtime/core/langchain-tools";
import { KnowledgeRowSchema } from "../../../packages/node-contracts/src/knowledge.list.v1.contract";
import { WorkItemDtoSchema } from "../../../packages/node-contracts/src/work.items.list.v1.contract";

const knowledgeRow = {
  id: "red-read-proof",
  domain: "build-agents",
  entityId: null,
  title: "Read proof",
  content: "Read envelope inheritance",
  useWhen: "consumer proof",
  entryType: "finding",
  confidencePct: 40,
  sourceType: "agent",
  sourceRef: null,
  tags: ["red"],
  evaluateAt: "2026-11-01T00:00:00.000Z",
  resolutionStrategy: "manual",
  createdAt: "2026-10-29T00:00:00.000Z",
};
const workItem: WorkItem = {
  id: toWorkItemId("task.0009"),
  type: "task",
  status: "needs_implement",
  title: "Red adoption",
  node: "red",
  actor: "ai",
  revision: 3,
  assignees: [{ kind: "agent", agentId: "red-consumer" }],
  externalRefs: [],
  labels: ["red"],
  specRefs: [],
  deployVerified: false,
  createdAt: "2026-10-29T00:00:00.000Z",
  updatedAt: "2026-10-29T00:00:00.000Z",
};

describe("Red released read-envelope and wrapper compatibility", () => {
  it("preserves public knowledge fields through read/search execution and validation", async () => {
    const knowledgeCapability: KnowledgeCapability = {
      get: async () => knowledgeRow,
      list: async () => [knowledgeRow],
      search: async () => [knowledgeRow],
      write: async () => {
        throw new Error("read proof must not write");
      },
    };
    const read = await createKnowledgeReadImplementation({
      knowledgeCapability,
    }).execute({ id: knowledgeRow.id });
    const search = await createKnowledgeSearchImplementation({
      knowledgeCapability,
      nodePublicOrigin: "https://red.cognidao.org",
    }).execute({ domain: knowledgeRow.domain, query: "proof" });
    const http = KnowledgeRowSchema.parse(knowledgeRow);
    const toolRead = knowledgeReadContract.outputSchema.parse(read).entries[0];
    const toolSearch =
      knowledgeSearchContract.outputSchema.parse(search).results[0];
    for (const row of [http, toolRead, toolSearch]) {
      // No exclusions: every canonical HTTP field must survive tool validation.
      for (const key of Object.keys(http)) expect(row).toHaveProperty(key);
      expect(row).toMatchObject({
        useWhen: "consumer proof",
        evaluateAt: knowledgeRow.evaluateAt,
        resolutionStrategy: "manual",
        createdAt: knowledgeRow.createdAt,
      });
    }
    expect(
      KnowledgeRowSchema.safeParse({ ...knowledgeRow, confidencePct: "40" })
        .success
    ).toBe(false);
    expect(
      knowledgeReadContract.outputSchema.safeParse({
        ...read,
        entries: [{ ...knowledgeRow, evaluateAt: 42 }],
      }).success
    ).toBe(false);
  });

  it("keeps canonical assignees in HTTP and the legacy id alias only in tool output", async () => {
    const dto = toWorkItemDto(workItem);
    const workItemCapability: WorkItemCapability = {
      query: async () => [dto],
      transitionStatus: async () => {
        throw new Error("read proof must not transition");
      },
    };
    const result = await createWorkItemQueryImplementation({
      workItemCapability,
    }).execute({});
    const http = WorkItemDtoSchema.parse(dto);
    const tool = workItemQueryContract.outputSchema.parse(result).items[0];
    for (const key of Object.keys(http)) expect(tool).toHaveProperty(key);
    expect(http.assignees).toEqual([
      { kind: "agent", agentId: "red-consumer" },
    ]);
    expect(tool?.assignees).toEqual([
      { kind: "agent", agentId: "red-consumer", id: "red-consumer" },
    ]);
    expect(
      WorkItemDtoSchema.safeParse({
        ...dto,
        assignees: [{ kind: "agent", id: "red-consumer" }],
      }).success
    ).toBe(false);
    expect(
      workItemQueryContract.outputSchema.safeParse({
        ...result,
        items: [{ ...tool, revision: "3" }],
      }).success
    ).toBe(false);
  });

  it("compiles Red's own HTTP tool and preserves deny-by-default execution", async () => {
    const redHttp = getToolById("core__http_request");
    if (!redHttp) throw new Error("Red scope-bound HTTP tool missing");
    const { spec } = toToolSpec(redHttp.contract);
    expect(spec.name).toBe("core__http_request");
    expect(spec.inputSchema).toMatchObject({ type: "object" });
    let executions = 0;
    const wrapped = makeLangChainTool({
      contract: redHttp.contract,
      execResolver: () => async () => {
        executions++;
        return { ok: true, value: { red: true } };
      },
    });
    const args = {
      targetBaseUrl: "https://red.cognidao.org",
      path: "/version",
      method: "GET",
    };
    expect(JSON.parse(await wrapped.invoke(args))).toMatchObject({
      error: "policy_denied",
    });
    expect(executions).toBe(0);
    expect(
      JSON.parse(
        await wrapped.invoke(args, {
          configurable: { toolIds: ["core__http_request"] },
        })
      )
    ).toEqual({ red: true });
    expect(executions).toBe(1);
  });
});
