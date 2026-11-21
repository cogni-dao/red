// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@tests/component/db/agent-authority-migration`
 * Purpose: Prove authority adoption against fresh, historical, and incompatible Postgres databases.
 * Scope: Executes the real node migration chain and released grants store with isolated app/service/migration roles.
 * Invariants: No capability bootstrap; legacy rows survive; delegated rows never authorize node tools; FORCE RLS holds.
 * Side-effects: Task-owned test databases/roles, removed in teardown.
 * Links: story.0090; database-migration-contract
 * @internal
 */

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPostgresAgentGrantsStore, type SqlTag } from "@cogni/agent-grants";
import { runGrantConformance } from "@cogni/agent-grants/grants-conformance";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrations = path.resolve(import.meta.dirname, "../../../src/adapters/server/db/migrations");
const nodeAi = "00000000-0000-4000-a000-0000000a0001";
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const roles = {
  app: `app_authority_${suffix}`,
  service: `service_authority_${suffix}`,
  migration: `migration_authority_${suffix}`,
};
const password = "isolated_authority_fixture";
let admin: postgres.Sql;
let baseline: string;

function urlFor(database: string, role?: string) {
  const adminUrl = process.env.TEST_POSTGRES_ADMIN_URL;
  if (!adminUrl) throw new Error("Component setup must provide its isolated Postgres admin URL");
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  if (role) {
    url.username = role;
    url.password = password;
  }
  return url.toString();
}

beforeAll(async () => {
  admin = postgres(urlFor("postgres"), { max: 1, onnotice: () => {} });
  for (const [kind, name] of Object.entries(roles)) {
    await admin.unsafe(
      `CREATE ROLE ${name} LOGIN PASSWORD '${password}' ${kind === "service" ? "BYPASSRLS" : "NOBYPASSRLS"}`,
    );
  }
  await admin.unsafe(`GRANT ${roles.app} TO ${roles.migration}`);
  // Use the exact immutable pre-adoption history, not a second model of its schema.
  baseline = await mkdtemp(path.join(tmpdir(), "red-authority-baseline-"));
  await mkdir(path.join(baseline, "meta"));
  const journal = JSON.parse(await readFile(path.join(migrations, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 35);
  await writeFile(path.join(baseline, "meta/_journal.json"), JSON.stringify(journal));
  for (const e of journal.entries)
    await copyFile(path.join(migrations, `${e.tag}.sql`), path.join(baseline, `${e.tag}.sql`));
}, 30_000);

afterAll(async () => {
  for (const name of [roles.migration, roles.service, roles.app])
    await admin.unsafe(`DROP ROLE ${name}`);
  await admin.end();
  await rm(baseline, { recursive: true, force: true });
});

async function fixture(
  run: (h: {
    app: postgres.Sql;
    service: postgres.Sql;
    migration: postgres.Sql;
    adopt: () => Promise<void>;
  }) => Promise<void>,
) {
  const database = `authority_${randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`CREATE DATABASE ${database} OWNER ${roles.app}`);
  const app = postgres(urlFor(database, roles.app), { max: 1, onnotice: () => {} });
  const service = postgres(urlFor(database, roles.service), { max: 1, onnotice: () => {} });
  const migration = postgres(urlFor(database, roles.migration), { max: 1, onnotice: () => {} });
  try {
    await app.unsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${roles.service}`,
    );
    await migrate(drizzle(app), { migrationsFolder: baseline });
    // Drizzle owns its ledger as the original app role; migration inherits that ownership.
    await run({
      app,
      service,
      migration,
      adopt: () => migrate(drizzle(migration), { migrationsFolder: migrations }),
    });
  } finally {
    await Promise.all([app.end(), service.end(), migration.end()]);
    await admin.unsafe(`DROP DATABASE ${database}`);
  }
}

// Historical 0036 + 0038 authority shape, before account grants. Deliberately
// independent of the new generated migration: a real old database is the input.
const legacy = `
CREATE TABLE agent_principals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, slug text,
 user_id text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT agent_principals_kind_canonical CHECK (kind IN ('internal','external')),
 CONSTRAINT agent_principals_internal_has_slug CHECK (kind <> 'internal' OR slug IS NOT NULL));
CREATE UNIQUE INDEX agent_principals_slug_unique ON agent_principals(slug);
CREATE UNIQUE INDEX agent_principals_user_id_unique ON agent_principals(user_id);
CREATE TABLE agent_roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), principal_user_id text NOT NULL REFERENCES users(id),
 scope text NOT NULL, approved_by text REFERENCES users(id), granted_at timestamptz,
 requested_by text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);
CREATE UNIQUE INDEX agent_roles_live_unique ON agent_roles(principal_user_id,scope) WHERE revoked_at IS NULL;
CREATE INDEX agent_roles_principal_idx ON agent_roles(principal_user_id);
ALTER TABLE agent_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_principals FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_principals_read ON agent_principals FOR SELECT USING (kind = 'internal');
ALTER TABLE agent_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_roles FORCE ROW LEVEL SECURITY;
`;

async function seed(sql: postgres.Sql) {
  await sql`INSERT INTO users(id, name) VALUES ('owner','Owner'), ('foreign','Foreign'), ('agent','Agent')`;
  await sql`INSERT INTO billing_accounts(id, owner_user_id, balance_credits) VALUES ('owned','owner',0), ('foreign-account','foreign',0)`;
}

async function asUser<T>(
  app: postgres.Sql,
  userId: string,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) {
  return app.begin(async (tx) => {
    await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
    return run(tx);
  });
}

describe("agent authority migration", () => {
  it("bootstraps canonical identity without approvals and fixes the released liveScopes query", async () => {
    await fixture(async ({ service, migration, adopt }) => {
      await migration`INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
        SELECT 'historical-unknown', max(created_at) + 1 FROM drizzle.__drizzle_migrations`;
      await adopt();
      const expectedJournal = JSON.parse(
        await readFile(path.join(migrations, "meta/_journal.json"), "utf8"),
      );
      const applied =
        await migration`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 2`;
      expect(applied.map((r) => Number(r.created_at))).toEqual(
        expectedJournal.entries
          .slice(-2)
          .reverse()
          .map((e: { when: number }) => e.when),
      );
      const store = createPostgresAgentGrantsStore(service as unknown as SqlTag);
      expect(await store.findInternalPrincipal("node-ai")).toEqual({ userId: nodeAi });
      expect(await store.liveScopes(nodeAi, ["sandbox:exec"])).toEqual([]);
      expect(await service`SELECT * FROM agent_roles`).toHaveLength(0);
      expect(await service`SELECT wallet_address, email FROM users WHERE id = ${nodeAi}`).toEqual([
        { wallet_address: null, email: null },
      ]);
      expect(await migration`SELECT current_user`).toEqual([{ current_user: roles.migration }]);
      expect(
        await service`SELECT c.relname FROM pg_class c WHERE c.oid IN ('agent_roles'::regclass,'agent_principals'::regclass) AND c.relrowsecurity AND c.relforcerowsecurity`,
      ).toHaveLength(2);
      await adopt(); // the journal makes a subsequent startup a no-op
      expect(await service`SELECT * FROM agent_roles`).toHaveLength(0);
    });
  });

  it("preserves approved, pending and revoked legacy rows, uniqueness, and narrower principal reads", async () => {
    await fixture(async ({ app, service, adopt }) => {
      await app.unsafe(legacy);
      await seed(service);
      await service`INSERT INTO agent_principals(kind,slug,user_id) VALUES ('external',NULL,'agent')`;
      await service`INSERT INTO agent_roles(principal_user_id,scope,approved_by,granted_at,revoked_at)
        VALUES ('agent','sandbox:exec','owner','2026-01-01',NULL), ('agent','off','owner','2026-01-01','2026-01-02'), ('agent','ask',NULL,NULL,NULL)`;
      const before = await service`SELECT * FROM agent_roles ORDER BY scope`;
      await adopt();
      const after =
        await service`SELECT id, principal_user_id, scope, approved_by, granted_at, requested_by, created_at, revoked_at FROM agent_roles ORDER BY scope`;
      expect(after).toEqual(before);
      const store = createPostgresAgentGrantsStore(service as unknown as SqlTag);
      expect(await store.liveScopes("agent", ["sandbox:exec", "off", "ask"])).toEqual([
        "sandbox:exec",
      ]);
      await expect(
        service`INSERT INTO agent_roles(principal_user_id,scope) VALUES ('agent','sandbox:exec')`,
      ).rejects.toMatchObject({ code: "23505" });
      expect(await app`SELECT * FROM agent_roles`).toHaveLength(0);
      expect(await app`SELECT * FROM agent_principals WHERE kind = 'external'`).toHaveLength(0);
      await service`UPDATE agent_roles SET revoked_at = now() WHERE scope = 'sandbox:exec'`;
      expect(await store.liveScopes("agent", ["sandbox:exec"])).toEqual([]);
    });
  });

  it("reconciles historical delegated grants without minting live node authority", async () => {
    await fixture(async ({ app, service, adopt }) => {
      await app.unsafe(legacy);
      await app.unsafe(`ALTER TABLE agent_roles ADD COLUMN resource_kind text NOT NULL DEFAULT 'node';
        ALTER TABLE agent_roles ADD COLUMN owner_user_id text;
        ALTER TABLE agent_roles ADD COLUMN expires_at timestamptz;
        ALTER TABLE agent_roles ADD CONSTRAINT agent_roles_resource_kind_canonical CHECK(resource_kind IN ('node','delegated'));`);
      await seed(service);
      await service`INSERT INTO agent_roles(principal_user_id,scope,approved_by,granted_at,resource_kind,expires_at)
        VALUES ('agent','sandbox:exec','owner','2026-01-01','delegated','2026-02-01'), ('agent','previously-off','owner','2026-01-01','delegated','2026-02-01')`;
      await service`UPDATE agent_roles SET revoked_at = '2026-01-02T00:00:00Z' WHERE scope = 'previously-off'`;
      await adopt();
      const rows =
        await service`SELECT scope, approved_by, revoked_at, expires_at FROM agent_roles ORDER BY scope`;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        approved_by: "owner",
        revoked_at: new Date("2026-01-02"),
        expires_at: null,
      });
      expect(rows[1]?.revoked_at).toBeInstanceOf(Date);
      expect(rows[1]?.expires_at).toBeNull();
      expect(
        await createPostgresAgentGrantsStore(service as unknown as SqlTag).liveScopes("agent", [
          "sandbox:exec",
        ]),
      ).toEqual([]);
    });
  });

  it("adopts pre-expanded columns while preserving narrower account policies and durable grants", async () => {
    await fixture(async ({ app, service, adopt }) => {
      await app.unsafe(legacy);
      await app.unsafe(`ALTER TABLE agent_roles ADD COLUMN resource text NOT NULL DEFAULT 'node';
        ALTER TABLE agent_roles ADD COLUMN account_id text;
        ALTER TABLE agent_roles ADD COLUMN expires_at timestamptz;
        CREATE POLICY agent_roles_account_self_read ON agent_roles FOR SELECT
          USING (resource = 'account' AND principal_user_id = current_setting('app.current_user_id', true) AND scope = 'account:read');
        CREATE POLICY agent_delegated_read ON billing_accounts FOR SELECT USING (false);`);
      await seed(service);
      await service`INSERT INTO agent_roles(principal_user_id,scope,approved_by,granted_at,resource,account_id)
        VALUES ('agent','account:read','owner','2026-01-01','account','owned'), ('agent','account:write','owner','2026-01-01','account','owned')`;
      await adopt();
      expect(
        await createPostgresAgentGrantsStore(service as unknown as SqlTag).hasLiveAccountGrant(
          "agent",
          "account:read",
          "owned",
        ),
      ).toBe(true);
      expect(await asUser(app, "agent", (tx) => tx`SELECT scope FROM agent_roles`)).toEqual([
        { scope: "account:read" },
      ]);
      expect(await asUser(app, "agent", (tx) => tx`SELECT id FROM billing_accounts`)).toEqual([]);
    });
  });

  it.each([
    ["column", `ALTER TABLE agent_roles ALTER COLUMN scope TYPE integer USING 1`],
    [
      "key",
      `DROP INDEX agent_roles_live_unique; CREATE UNIQUE INDEX agent_roles_live_unique ON agent_roles(id)`,
    ],
    ["unknown column", `ALTER TABLE agent_roles ADD COLUMN surprise_authority text`],
    ["write policy", `CREATE POLICY unexpected_write ON agent_roles FOR INSERT WITH CHECK (true)`],
    ["missing FORCE", `ALTER TABLE agent_roles NO FORCE ROW LEVEL SECURITY`],
    [
      "foreign key",
      `ALTER TABLE agent_roles DROP CONSTRAINT agent_roles_principal_user_id_fkey; ALTER TABLE agent_roles ADD FOREIGN KEY(principal_user_id) REFERENCES billing_accounts(id)`,
    ],
    ["ambiguous delegation", `ALTER TABLE agent_roles ADD COLUMN expires_at timestamptz`],
    ["target type", `ALTER TABLE agent_roles ADD COLUMN resource integer`],
  ])("refuses incompatible %s atomically", async (_name, change) => {
    await fixture(async ({ app, service, adopt }) => {
      await app.unsafe(legacy);
      await app.unsafe(change);
      await expect(adopt()).rejects.toMatchObject({
        cause: {
          code: "P0001",
          message: expect.stringMatching(/incompatible authority|unknown authority/),
        },
      });
      expect(await service`SELECT * FROM users WHERE id = ${nodeAi}`).toHaveLength(0);
      expect(
        await app`SELECT * FROM drizzle.__drizzle_migrations WHERE created_at > (SELECT max(created_at) FROM drizzle.__drizzle_migrations WHERE created_at <= 1795144912321)`,
      ).toHaveLength(0);
    });
  });

  it("enforces durable account reads as the real app role, with revocation taking immediate effect", async () => {
    await fixture(async ({ app, service, adopt }) => {
      await adopt();
      await seed(service);
      await service`INSERT INTO agent_roles(principal_user_id,scope,resource,account_id,approved_by,granted_at)
        VALUES ('agent','account:read','account','owned','owner','2026-01-01')`;
      const store = createPostgresAgentGrantsStore(service as unknown as SqlTag);
      expect(await store.hasLiveAccountGrant("agent", "account:read", "owned")).toBe(true);
      expect(await store.liveScopes("agent", ["account:read"])).toEqual([]);
      const visible = () =>
        asUser(app, "agent", (tx) => tx`SELECT id FROM billing_accounts ORDER BY id`);
      expect(await visible()).toEqual([{ id: "owned" }]);
      expect(await asUser(app, "owner", (tx) => tx`SELECT id FROM billing_accounts`)).toEqual([
        { id: "owned" },
      ]);
      expect(await asUser(app, "foreign", (tx) => tx`SELECT id FROM billing_accounts`)).toEqual([
        { id: "foreign-account" },
      ]);
      expect(await app`SELECT * FROM billing_accounts`).toHaveLength(0);
      await expect(
        asUser(
          app,
          "agent",
          (tx) =>
            tx`INSERT INTO agent_roles(principal_user_id,scope) VALUES ('agent','self:grant')`,
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await service`UPDATE agent_roles SET expires_at = '2026-01-02' WHERE principal_user_id = 'agent'`;
      expect(await visible()).toEqual([]);
      expect(await store.hasLiveAccountGrant("agent", "account:read", "owned")).toBe(false);
      await service`UPDATE agent_roles SET expires_at = NULL, revoked_at = now() WHERE principal_user_id = 'agent'`;
      expect(await visible()).toEqual([]);
      expect(await store.hasLiveAccountGrant("agent", "account:read", "owned")).toBe(false);
    });
  });
});

// Reuse the released behavioral contract over the actual adopted SQL store.
// Every case gets its own complete database and real separated roles.
let conformanceService: postgres.Sql;
runGrantConformance({
  describe,
  it: (name, run) =>
    it(name, () =>
      fixture(async ({ service, adopt }) => {
        await adopt();
        conformanceService = service;
        await run();
      }),
    ),
  expect,
  async setup(spec) {
    const ids: Record<string, string> = {};
    const accounts: Record<string, string> = {};
    for (const name of [...spec.owners, ...spec.agents, ...spec.internal]) {
      const id = name === "node-ai" ? nodeAi : randomUUID();
      ids[name] = id;
      await conformanceService`INSERT INTO users(id,name) VALUES (${id},${name}) ON CONFLICT(id) DO NOTHING`;
      if (spec.internal.includes(name)) {
        await conformanceService`INSERT INTO agent_principals(kind,slug,user_id) VALUES ('internal',${name},${id}) ON CONFLICT(user_id) DO NOTHING`;
      } else if (spec.agents.includes(name)) {
        await conformanceService`INSERT INTO agent_principals(kind,user_id) VALUES ('external',${id})`;
      }
      if (spec.owners.includes(name)) {
        accounts[name] = randomUUID();
        await conformanceService`INSERT INTO billing_accounts(id,owner_user_id,balance_credits) VALUES (${accounts[name]},${id},0)`;
      }
    }
    return {
      ids,
      accounts,
      store: createPostgresAgentGrantsStore(conformanceService as unknown as SqlTag),
    };
  },
  async expireGrant(id, scope) {
    await conformanceService`UPDATE agent_roles SET granted_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE principal_user_id = ${id} AND scope = ${scope} AND revoked_at IS NULL`;
  },
  async expireLink(id, scope) {
    await conformanceService`UPDATE agent_roles SET link_expires_at = now() - interval '1 day' WHERE principal_user_id = ${id} AND scope = ${scope} AND revoked_at IS NULL`;
  },
  broken: () =>
    createPostgresAgentGrantsStore(() => {
      throw new Error("isolated test outage");
    }),
});
