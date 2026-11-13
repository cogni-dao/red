// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/unit/app/api/agent-credentials.routes`
 * Purpose: This node's wiring of the revocable agent key routes: the auth shell answers 401 / 403 / 429 / 503 the way the package maps them.
 * Scope: The REAL routes, route wrapper, resolver (request-identity.ts) and the package's credential service over a stub store. The key state machine is the
 *   package's own conformance suite, run over real SQL in tests/component/db/agent-credentials.int.test.ts. Fakes: the store, the header source, the container.
 * Invariants: V1_ONLY, FAIL_CLOSED_NON_DISCLOSING, OVER_LIMIT_IS_429, STORE_OUTAGE_IS_NOT_401.
 * Side-effects: none
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatRevocableKey, REVOCABLE_KEY_PREFIX } from "@cogni/agent-grants/credentials";

const fake = vi.hoisted(() => ({
  headers: new Map<string, string>(),
  /** false = the per-IP lookup limiter is exhausted. */
  admit: true,
  /** How many limiter tokens lookups that found no usable key have spent (SPEND_ON_MISS). */
  misses: 0,
  store: undefined as unknown as Record<string, ReturnType<typeof vi.fn>>,
}));
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
log.child.mockReturnValue(log);

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (n: string) => fake.headers.get(n.toLowerCase()) ?? null }),
}));
vi.mock("@/lib/auth/server", () => ({ getServerSessionUser: async () => null }));
vi.mock("@/shared/env/server", () => ({ serverEnv: () => ({ AUTH_SECRET: "test-secret-for-unit-tests-only-0123456789" }) }));
vi.mock("@/bootstrap/container", () => ({
  getContainer: () => ({ log, config: { unhandledErrorPolicy: "respond_500" }, clock: { now: () => "2026-11-10T00:00:00Z" } }),
}));
vi.mock("@/bootstrap/agent-credentials", () => ({
  getAgentCredentialStore: () => fake.store,
  admitCredentialLookup: () => fake.admit,
  recordCredentialMiss: () => {
    fake.misses += 1;
  },
}));

import { issueAgentApiKey } from "@/app/_lib/auth/request-identity";
import { POST as confirm } from "@/app/api/v1/agent/credentials/confirm/route";
import { POST as revoke } from "@/app/api/v1/agent/credentials/revoke/route";
import { POST as rotate } from "@/app/api/v1/agent/credentials/rotate/route";
import { POST as upgrade } from "@/app/api/v1/agent/credentials/upgrade/route";

const USER = "agent-user-1";
const post = (handler: (r: NextRequest, c: never) => Promise<Response>, key: string | null) => {
  fake.headers.clear();
  if (key) fake.headers.set("authorization", `Bearer ${key}`);
  return handler(
    new NextRequest("http://localhost/api/v1/agent/credentials/x", {
      method: "POST",
      ...(key ? { headers: { authorization: `Bearer ${key}` } } : {}),
    }),
    undefined as never
  );
};
const v1 = () => issueAgentApiKey({ userId: USER, displayName: "Flock" });
const revocable = () => formatRevocableKey("A".repeat(43));
const lookup = (state: string) => ({
  credentialId: "cred-1",
  userId: USER,
  name: "Flock",
  state,
  expiresAt: "2026-12-01T00:00:00Z",
  renewUntil: "2026-12-31T00:00:00Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  fake.admit = true;
  fake.misses = 0;
  log.child.mockReturnValue(log);
  fake.store = {
    lookup: vi.fn(async () => null),
    everConfirmed: vi.fn(async () => false),
    issueUpgrade: vi.fn(async () => ({ ok: true, credentialId: "cred-2", userId: USER, pendingExpiresAt: "2026-11-13T00:00:00Z" })),
    issueSuccessor: vi.fn(),
    confirm: vi.fn(),
    revoke: vi.fn(),
  };
});

describe("upgrade", () => {
  it("a signed key gets a pending revocable key for the SAME user id, uncached", async () => {
    const res = await post(upgrade as never, v1());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ userId: USER, status: "pending" });
    expect(body.apiKey.startsWith(REVOCABLE_KEY_PREFIX)).toBe(true);
    expect(fake.store.issueUpgrade).toHaveBeenCalledWith(expect.objectContaining({ userId: USER }));
  });

  it("refuses no key and a forged signed key with 401", async () => {
    expect((await post(upgrade as never, null)).status).toBe(401);
    expect((await post(upgrade as never, "cogni_ag_sk_v1_forged.sig")).status).toBe(401);
  });

  it("refuses a revocable key (V1_ONLY)", async () => {
    fake.store.lookup = vi.fn(async () => lookup("active"));
    const res = await post(upgrade as never, revocable());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "signed_key_required" });
  });

  it("a user the store refuses (wallet) is 403 not_agent_key", async () => {
    fake.store.issueUpgrade = vi.fn(async () => ({ ok: false, reason: "wallet_user" }));
    const res = await post(upgrade as never, v1());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_agent_key" });
  });

  it("a signed key is 401 v1_superseded once its user confirmed a revocable key", async () => {
    fake.store.everConfirmed = vi.fn(async () => true);
    const res = await post(upgrade as never, v1());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "v1_superseded" });
  });
});

describe("revocable key routes", () => {
  it("no key and an unknown key are the same 401 with a Bearer challenge; only the miss spends a limiter token", async () => {
    const none = await post(rotate as never, null);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toContain("invalid_token");
    expect(fake.misses).toBe(0);
    expect((await post(rotate as never, revocable())).status).toBe(401);
    expect(fake.misses).toBe(1);
  });

  it("a pending key cannot rotate; an active key can", async () => {
    fake.store.lookup = vi.fn(async () => lookup("pending"));
    expect((await post(rotate as never, revocable())).status).toBe(401);
    fake.store.lookup = vi.fn(async () => lookup("active"));
    fake.store.issueSuccessor = vi.fn(async () => ({ ok: true, credentialId: "cred-3", userId: USER, pendingExpiresAt: "2026-11-13T00:00:00Z" }));
    const res = await post(rotate as never, revocable());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: USER, status: "pending" });
  });

  it("a client over the lookup limit is 429 and the store is not read", async () => {
    fake.admit = false;
    const res = await post(confirm as never, revocable());
    expect(res.status).toBe(429);
    expect(fake.store.lookup).not.toHaveBeenCalled();
  });

  it("a store outage is 503 authz_unavailable, never 401", async () => {
    fake.store.lookup = vi.fn(async () => {
      throw new Error("db down");
    });
    for (const route of [rotate, confirm, revoke]) {
      const res = await post(route as never, revocable());
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: "authz_unavailable" });
    }
  });
});
