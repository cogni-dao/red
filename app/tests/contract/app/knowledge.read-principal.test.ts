// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/contract/app/knowledge.read-principal`
 * Purpose: Lock in KNOWLEDGE_READ_REQUIRES_PRINCIPAL — bearer-token agents may
 *   read the knowledge plane (list, single entry, citation graph, domain
 *   registry) just like cookie-session humans. Regression guard for the v0
 *   guard that 403'd every bearer browse request.
 * Scope: Exercises the four GET read routes with an `Authorization: Bearer`
 *   header against a seeded fake store. Does not test write/contribution paths.
 * Invariants: a bearer-bearing read returns 200 (never 403); link-pulling
 *   (graph edges) is reachable by agents.
 * Side-effects: none (container + auth mocked, fake in-memory store)
 * Links: src/app/api/v1/knowledge, https://node-template.cognidao.org/knowledge/knowledge-write-contract
 * @internal
 */

import { FakeKnowledgeStoreAdapter } from "@cogni/knowledge-store/adapters/fake";
import { TEST_SESSION_USER_1 } from "@tests/_fakes/ids";
import { testApiHandler } from "next-test-api-route-handler";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fresh fake store per test (reassigned in beforeEach); the container mock
// hands the current instance to every route. Lazy factory => reads latest value.
let mockStore: FakeKnowledgeStoreAdapter;

// The real route door over a fake SQL tag: answers the role lookup from `roles` ("<principal>|<scope>").
const grants = vi.hoisted(() => ({ roles: new Set<string>(), authority: undefined as unknown }));

vi.mock("@/bootstrap/container", () => ({
  getContainer: vi.fn(() => ({
    agentAuthority: grants.authority,
    log: {
      child: vi.fn(() => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      })),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    clock: { now: vi.fn(() => new Date("2026-01-01T00:00:00Z")) },
    config: { unhandledErrorPolicy: "rethrow" },
    knowledgeStorePort: mockStore,
  })),
}));

// A resolved session user models a *successful bearer-token auth*: the real
// resolveRequestIdentity returns a SessionUser for a valid `cogni_ag_sk_v1_`
// token. We send a Bearer header on every request so the old guard — which
// keyed off that header — would have returned 403.
vi.mock("@/app/_lib/auth/session", () => ({
  getSessionUser: vi.fn().mockResolvedValue(TEST_SESSION_USER_1),
}));

import { CORE_TOOL_BUNDLE } from "@cogni/ai-tools";
import { getSessionUser } from "@/app/_lib/auth/session";
import {
  type AgentAuthoritySql,
  createAgentToolAuthority,
} from "@/bootstrap/agent-authority";
import * as entryHandler from "@/app/api/v1/knowledge/[id]/route";
import * as domainsHandler from "@/app/api/v1/knowledge/domains/route";
import * as graphHandler from "@/app/api/v1/knowledge/graph/route";
import * as listHandler from "@/app/api/v1/knowledge/route";

const BEARER = { authorization: "Bearer cogni_ag_sk_v1_test.signature" };

async function seedStore(store: FakeKnowledgeStoreAdapter) {
  await store.registerDomain({ id: "eng", name: "Engineering" });
  await store.withWrite(
    {
      operationId: "fixture:knowledge-read-principal",
      message: "Seed knowledge read fixture",
    },
    async (write) => {
      await write.upsertKnowledge({
        id: "entry-a",
        domain: "eng",
        title: "Entry A",
        content: "alpha",
        sourceType: "agent",
      });
      await write.upsertKnowledge({
        id: "entry-b",
        domain: "eng",
        title: "Entry B",
        content: "beta",
        sourceType: "agent",
      });
      // Citation edge so the graph route proves agent link-pulling, not just nodes.
      await write.addCitation({
        citingId: "entry-a",
        citedId: "entry-b",
        citationType: "extends",
      });
    }
  );
}

function fakeSql(): AgentAuthoritySql {
  const tag = (async (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.join("?").includes("FROM agent_roles") &&
    grants.roles.has(`${values[0]}|${values[1]}`)
      ? [{ ok: 1 }]
      : []) as unknown as AgentAuthoritySql;
  (tag as unknown as { begin: unknown }).begin = async (
    fn: (t: unknown) => Promise<unknown>
  ) => fn(tag);
  return tag;
}

function makeAuthority() {
  const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return createAgentToolAuthority({
    sql: fakeSql(),
    nodeAdmin: { check: async () => ({ ok: false, errorCode: "authz_denied" }) },
    log: quiet as never,
    toolBundle: CORE_TOOL_BUNDLE as never,
  });
}

describe("knowledge read routes — KNOWLEDGE_READ_NEEDS_GRANT", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockStore = new FakeKnowledgeStoreAdapter();
    await seedStore(mockStore);
    // clearAllMocks keeps the default session user (no `via`: the strict bearer branch).
    grants.roles = new Set([`${TEST_SESSION_USER_1.id}|knowledge:read`]);
    grants.authority = makeAuthority();
  });

  it("GET /knowledge returns 200 for a bearer agent (not 403)", async () => {
    await testApiHandler({
      appHandler: listHandler,
      url: "/api/v1/knowledge",
      async test({ fetch }) {
        const res = await fetch({ method: "GET", headers: BEARER });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.items).toHaveLength(2);
        expect(body.domains).toContain("eng");
      },
    });
  });

  it("GET /knowledge/[id] returns 200 for a bearer agent (not 403)", async () => {
    await testApiHandler({
      appHandler: entryHandler,
      params: { id: "entry-a" },
      url: "/api/v1/knowledge/entry-a",
      async test({ fetch }) {
        const res = await fetch({ method: "GET", headers: BEARER });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.id).toBe("entry-a");
      },
    });
  });

  it.each([
    { id: "entry-a", useWhen: "Use when reviewing this entry." },
    { id: "entry-b", useWhen: null },
  ])("serializes the retrieval trigger for $id at the read boundary", async ({
    id,
    useWhen,
  }) => {
    const entry = await mockStore.getKnowledge(id);
    if (!entry) throw new Error("Seeded entry is missing");
    const getKnowledge = vi.spyOn(mockStore, "getKnowledge");
    // The immutable 0.3.3 fake write path omits useWhen. Supply its typed
    // read result only for projection coverage, not persistence proof.
    if (useWhen !== null) {
      getKnowledge.mockResolvedValueOnce({ ...entry, useWhen });
    }
    try {
      await testApiHandler({
        appHandler: entryHandler,
        params: { id },
        url: `/api/v1/knowledge/${id}`,
        async test({ fetch }) {
          const res = await fetch({ method: "GET", headers: BEARER });
          expect(res.status).toBe(200);
          const body = await res.json();
          expect(body.id).toBe(id);
          expect(body.useWhen).toBe(useWhen);
        },
      });
      expect(getKnowledge).toHaveBeenCalledTimes(1);
      expect(getKnowledge).toHaveBeenCalledWith(id);
    } finally {
      getKnowledge.mockRestore();
    }
  });

  it("GET /knowledge/graph returns 200 + edges for a bearer agent (link-pulling)", async () => {
    await testApiHandler({
      appHandler: graphHandler,
      url: "/api/v1/knowledge/graph",
      async test({ fetch }) {
        const res = await fetch({ method: "GET", headers: BEARER });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.nodes).toHaveLength(2);
        expect(body.edges).toEqual([
          expect.objectContaining({
            source: "entry-a",
            target: "entry-b",
            citationType: "extends",
          }),
        ]);
      },
    });
  });

  it("GET /knowledge/domains returns 200 for a bearer agent (not 403)", async () => {
    await testApiHandler({
      appHandler: domainsHandler,
      url: "/api/v1/knowledge/domains",
      async test({ fetch }) {
        const res = await fetch({ method: "GET", headers: BEARER });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.domains.map((d: { id: string }) => d.id)).toContain("eng");
      },
    });
  });
});

describe("knowledge read door — bearer without the role is 403, a human is 200", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockStore = new FakeKnowledgeStoreAdapter();
    await seedStore(mockStore);
    grants.roles = new Set();
    grants.authority = makeAuthority();
  });

  it("a bearer with no knowledge:read row is 403 policy_denied; once it is turned on it is 200", async () => {
    await testApiHandler({
      appHandler: listHandler,
      url: "/api/v1/knowledge",
      async test({ fetch }) {
        const denied = await fetch({ method: "GET", headers: BEARER });
        expect(denied.status).toBe(403);
        expect(await denied.json()).toEqual({ error: "policy_denied", code: "policy_denied" });
        grants.roles.add(`${TEST_SESSION_USER_1.id}|knowledge:read`);
        expect((await fetch({ method: "GET", headers: BEARER })).status).toBe(200);
      },
    });
  });

  it("a signed-in human session reads with no role row", async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce({ ...TEST_SESSION_USER_1, via: "session" });
    await testApiHandler({
      appHandler: listHandler,
      url: "/api/v1/knowledge",
      async test({ fetch }) {
        const res = await fetch({ method: "GET" });
        expect(res.status).toBe(200);
        expect((await res.json()).items).toHaveLength(2);
      },
    });
  });
});
