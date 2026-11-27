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
import { runCredentialConformance } from "@cogni/agent-grants/conformance";
import {
  agentRolesHasRoles,
  assertV1NotSuperseded,
  confirmCredential,
  type CredentialSql,
  createPostgresCredentialStore,
  upgradeSignedKey,
  verifyBearer,
} from "@cogni/agent-grants/credentials";
import { runGrantConformance } from "@cogni/agent-grants/grants-conformance";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrations = path.resolve(import.meta.dirname, "../../../src/adapters/server/db/migrations");
const nodeAi = "00000000-0000-4000-a000-0000000a0001";
const prioritizer = "00000000-0000-4000-a000-0000000a0002";
const redSolver = "00000000-0000-4000-a000-0000000b0001";
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const roles = {
  app: `app_authority_${suffix}`,
  service: `service_authority_${suffix}`,
  migration: `migration_authority_${suffix}`,
};
const password = "isolated_authority_fixture";
let admin: postgres.Sql;
let baseline: string;
let through36: string;

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
  // The candidate-a state: history through 0036 applied, 0037 not yet (the adopt path starts here).
  through36 = await mkdtemp(path.join(tmpdir(), "red-authority-through36-"));
  await mkdir(path.join(through36, "meta"));
  const full = JSON.parse(await readFile(path.join(migrations, "meta/_journal.json"), "utf8"));
  full.entries = full.entries.filter((e: { idx: number }) => e.idx < 37);
  await writeFile(path.join(through36, "meta/_journal.json"), JSON.stringify(full));
  for (const e of full.entries)
    await copyFile(path.join(migrations, `${e.tag}.sql`), path.join(through36, `${e.tag}.sql`));
}, 30_000);

afterAll(async () => {
  for (const name of [roles.migration, roles.service, roles.app])
    await admin.unsafe(`DROP ROLE ${name}`);
  await admin.end();
  await rm(baseline, { recursive: true, force: true });
  await rm(through36, { recursive: true, force: true });
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
      // 0039: the in-process provider's principal lock needs a seed row for each catalog graph's principal (no role rows).
      expect(await store.findInternalPrincipal("prioritizer")).toEqual({ userId: prioritizer });
      expect(await store.findInternalPrincipal("red-solver")).toEqual({ userId: redSolver });
      expect(await store.liveScopes(redSolver, ["red.http_request", "sandbox:exec"])).toEqual([]);
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

  it.each(["", " NOT VALID", " NO INHERIT"])(
    "retains additional legacy CHECKs%s and intersects them with canonical authority",
    async (mode) => {
      await fixture(async ({ app, service, adopt }) => {
        await app.unsafe(legacy);
        // Exact principal restrictions from reverted #366 (803a05b0), plus a
        // node-local narrower role scope. None is a canonical target name.
        await app.unsafe(`ALTER TABLE agent_principals ADD COLUMN owner_user_id text;
          ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_owner_external_only
            CHECK (kind = 'external' OR owner_user_id IS NULL)${mode};
          ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_owner_not_self
            CHECK (owner_user_id IS NULL OR owner_user_id <> user_id)${mode};
          ALTER TABLE agent_roles ADD CONSTRAINT red_scope_restricted CHECK (scope <> 'forbidden')${mode};
          ALTER TABLE agent_roles ADD CONSTRAINT agent_roles_no_self_approval
            CHECK (approved_by IS NULL OR approved_by <> principal_user_id);`);
        await seed(service);
        await service`INSERT INTO agent_roles(principal_user_id,scope,approved_by,granted_at)
          VALUES ('agent','sandbox:exec','owner','2026-01-01')`;
        const checks =
          () => service`SELECT oid, conname, pg_get_constraintdef(oid) AS definition, convalidated, connoinherit
          FROM pg_constraint WHERE conrelid IN ('agent_principals'::regclass,'agent_roles'::regclass)
          AND conname IN ('agent_principals_owner_external_only','agent_principals_owner_not_self','red_scope_restricted','agent_roles_no_self_approval')
          ORDER BY conname`;
        const before = await checks();
        await adopt();
        expect(await checks()).toEqual(before);
        await expect(service`INSERT INTO agent_principals(kind,slug,user_id,owner_user_id)
          VALUES ('internal','owned-internal','agent','owner')`).rejects.toMatchObject({
          code: "23514",
          constraint_name: "agent_principals_owner_external_only",
        });
        await expect(service`INSERT INTO agent_principals(kind,user_id,owner_user_id)
          VALUES ('external','agent','agent')`).rejects.toMatchObject({
          code: "23514",
          constraint_name: "agent_principals_owner_not_self",
        });
        await expect(service`INSERT INTO agent_roles(principal_user_id,scope)
          VALUES ('agent','forbidden')`).rejects.toMatchObject({
          code: "23514",
          constraint_name: "red_scope_restricted",
        });
        await expect(service`INSERT INTO agent_roles(principal_user_id,scope,approved_by)
          VALUES ('agent','self:grant','agent')`).rejects.toMatchObject({
          code: "23514",
          constraint_name: "agent_roles_no_self_approval",
        });
        const store = createPostgresAgentGrantsStore(service as unknown as SqlTag);
        expect(await store.liveScopes("agent", ["sandbox:exec"])).toEqual(["sandbox:exec"]);
        await service`UPDATE agent_roles SET revoked_at = now() WHERE principal_user_id = 'agent'`;
        expect(await store.liveScopes("agent", ["sandbox:exec"])).toEqual([]);
        expect(await app`SELECT * FROM agent_roles`).toHaveLength(0);
      });
    },
  );

  it("reconciles historical delegated grants without minting live node authority", async () => {
    await fixture(async ({ app, service, adopt }) => {
      await app.unsafe(legacy);
      await app.unsafe(`ALTER TABLE agent_roles ADD COLUMN resource_kind text NOT NULL DEFAULT 'node';
        ALTER TABLE agent_roles ADD COLUMN owner_user_id text;
        ALTER TABLE agent_roles ADD COLUMN expires_at timestamptz;
        ALTER TABLE agent_roles ADD CONSTRAINT agent_roles_resource_kind_canonical CHECK(resource_kind IN ('node','delegated'));
        ALTER TABLE agent_roles ADD CONSTRAINT agent_roles_owner_shape CHECK ((resource_kind = 'node') = (owner_user_id IS NULL));
        ALTER TABLE agent_roles ADD CONSTRAINT agent_roles_personal_approver CHECK (resource_kind = 'node' OR approved_by IS NULL OR (approved_by = owner_user_id AND approved_by <> principal_user_id AND expires_at IS NOT NULL));
        ALTER TABLE agent_roles ADD CONSTRAINT agent_roles_personal_scope_delegable CHECK (resource_kind = 'node' OR scope IN ('knowledge:read','knowledge:contribute'));`);
      await seed(service);
      await service`INSERT INTO agent_roles(principal_user_id,scope,approved_by,granted_at,resource_kind,expires_at,owner_user_id)
        VALUES ('agent','knowledge:read','owner','2026-01-01','delegated','2026-02-01','owner'), ('agent','knowledge:contribute','owner','2026-01-01','delegated','2026-02-01','owner')`;
      await service`UPDATE agent_roles SET revoked_at = '2026-01-02T00:00:00Z' WHERE scope = 'knowledge:contribute'`;
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
          "knowledge:read",
          "knowledge:contribute",
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
    [
      "principal kind CHECK",
      `ALTER TABLE agent_principals DROP CONSTRAINT agent_principals_kind_canonical;
      ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_kind_canonical CHECK (true)`,
    ],
    [
      "principal slug CHECK",
      `ALTER TABLE agent_principals DROP CONSTRAINT agent_principals_internal_has_slug;
      ALTER TABLE agent_principals ADD CONSTRAINT agent_principals_internal_has_slug CHECK (true)`,
    ],
    ...[
      "resource_canonical",
      "node_shape",
      "account_live_shape",
      "no_self_approval",
      "link_consumed_has_no_hash",
    ].map((name) => [
      `${name} CHECK`,
      `ALTER TABLE agent_roles ADD CONSTRAINT agent_roles_${name} CHECK (true)`,
    ]),
    [
      "narrower canonical CHECK",
      `ALTER TABLE agent_roles ADD CONSTRAINT agent_roles_no_self_approval CHECK (approved_by IS NULL)`,
    ],
    [
      "unvalidated canonical CHECK",
      `ALTER TABLE agent_roles ADD CONSTRAINT agent_roles_no_self_approval
      CHECK (approved_by IS NULL OR approved_by <> principal_user_id) NOT VALID`,
    ],
    [
      "superseded canonical CHECK",
      `ALTER TABLE agent_roles ADD COLUMN resource_kind text NOT NULL DEFAULT 'node';
      ALTER TABLE agent_roles ADD COLUMN owner_user_id text;
      ALTER TABLE agent_roles ADD CONSTRAINT agent_roles_owner_shape CHECK (true)`,
    ],
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

// red#67 (story.5158, reverted) left agent_credentials on candidate-a. This is that shape, written independently of 0037: a real old database is the input.
const preexistingCredentials = `
CREATE TABLE agent_credentials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, token_hash text NOT NULL, created_from text NOT NULL,
 predecessor_id uuid, issued_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, renew_until timestamptz NOT NULL,
 pending_expires_at timestamptz, confirmed_at timestamptz, revoked_at timestamptz, revoked_reason text, revoked_by text,
 CONSTRAINT agent_credentials_created_from_canonical CHECK (created_from IN ('spawn_grant','rotation','key_upgrade','binding_recovery','recovery_grant')),
 CONSTRAINT agent_credentials_renew_after_expiry CHECK (renew_until > expires_at));
ALTER TABLE agent_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_credentials ADD CONSTRAINT agent_credentials_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE agent_credentials ADD CONSTRAINT agent_credentials_predecessor_id_fk FOREIGN KEY (predecessor_id) REFERENCES agent_credentials(id);
CREATE UNIQUE INDEX agent_credentials_token_hash_unique ON agent_credentials(token_hash);
CREATE UNIQUE INDEX agent_credentials_one_pending_successor ON agent_credentials(predecessor_id) WHERE confirmed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX agent_credentials_user_idx ON agent_credentials(user_id);
ALTER TABLE agent_credentials FORCE ROW LEVEL SECURITY;
`;

/** Candidate-like start: history through 0036, then the red#67 table with real rows (inserted as the service role, so the phantom-orphan RLS condition holds for the owner). */
async function candidateLike(h: { app: postgres.Sql; service: postgres.Sql; migration: postgres.Sql }) {
  await migrate(drizzle(h.migration), { migrationsFolder: through36 });
  await h.app.unsafe(preexistingCredentials);
  await h.service`INSERT INTO users(id,name) VALUES ('a1','agent one'),('a2','agent two')`;
  await h.service`INSERT INTO agent_principals(kind,user_id) VALUES ('external','a1'),('external','a2')`;
  await h.service`INSERT INTO agent_credentials(user_id,token_hash,created_from,expires_at,renew_until,confirmed_at) VALUES
    ('a1','h1','key_upgrade',now()+interval '30 days',now()+interval '60 days',now()),
    ('a2','h2','key_upgrade',now()+interval '30 days',now()+interval '60 days',now())`;
}

async function credentialSnapshot(service: postgres.Sql) {
  const [rows] = await service`SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) AS md5, count(*)::int AS n FROM agent_credentials t`;
  const constraints = await service`SELECT conname, oid::int AS oid, convalidated FROM pg_constraint WHERE conrelid = 'public.agent_credentials'::regclass ORDER BY conname`;
  const indexes = await service`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'agent_credentials' ORDER BY indexname`;
  return { rows, constraints, indexes };
}

describe("0037 adopt path (the candidate-a state)", () => {
  it("adopts a pre-existing agent_credentials without touching its rows, constraints or the users foreign key, then 0038 applies and a re-run is a no-op", async () => {
    await fixture(async (h) => {
      await candidateLike(h);
      const before = await credentialSnapshot(h.service);
      expect(before.rows?.n).toBe(2);
      expect(before.constraints.every((c) => c.convalidated)).toBe(true);
      await h.migration.unsafe("SELECT 1"); // the migrating role stays usable
      await migrate(drizzle(h.migration), { migrationsFolder: migrations });
      expect(await credentialSnapshot(h.service)).toEqual(before); // rows, constraint oids and index definitions are byte-identical
      expect(await h.service`SELECT to_regclass('public.payer_bindings')::text AS t`).toEqual([{ t: "payer_bindings" }]);
      expect(
        await h.service`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'agent_principals' AND column_name IN ('owner_source_kind','owner_source_ref')`,
      ).toEqual([{ n: 2 }]);
      expect(await h.service`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'agent_credentials_external_principal_only'`).toEqual([{ n: 1 }]);
      await migrate(drizzle(h.migration), { migrationsFolder: migrations }); // journal makes it a no-op
      expect(await credentialSnapshot(h.service)).toEqual(before);
      // The guarantee is in the SQL, not the journal: execute 0037 itself a second time, in one transaction as the migrator does.
      const statements = (await readFile(path.join(migrations, "0037_past_gorgon.sql"), "utf8"))
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);
      await h.migration.begin(async (tx) => {
        for (const statement of statements) await tx.unsafe(statement);
      });
      expect(await credentialSnapshot(h.service)).toEqual(before);
      expect(await h.service`SELECT to_regclass('public.payer_bindings')::text AS t`).toEqual([{ t: "payer_bindings" }]);
    });
  });

  it.each([
    ["an extra column", `ALTER TABLE agent_credentials ADD COLUMN surprise text`, /agent_credentials exists with an unexpected shape/],
    ["a wrong column type", `ALTER TABLE agent_credentials ALTER COLUMN token_hash TYPE varchar(64)`, /agent_credentials exists with an unexpected shape/],
    ["a missing check constraint", `ALTER TABLE agent_credentials DROP CONSTRAINT agent_credentials_renew_after_expiry`, /without its primary key or check constraints/],
  ])("fails closed on %s and changes nothing", async (_name, drift, message) => {
    await fixture(async (h) => {
      await candidateLike(h);
      await h.app.unsafe(drift);
      const before = await credentialSnapshot(h.service);
      await expect(migrate(drizzle(h.migration), { migrationsFolder: migrations })).rejects.toMatchObject({
        cause: { message: expect.stringMatching(message) },
      });
      expect(await credentialSnapshot(h.service)).toEqual(before);
      expect(await h.service`SELECT to_regclass('public.payer_bindings')::text AS t`).toEqual([{ t: null }]); // the whole batch rolled back
    });
  });

  it("fails closed on a pre-existing payer_bindings of unknown shape", async () => {
    await fixture(async (h) => {
      await candidateLike(h);
      await h.app.unsafe(`CREATE TABLE payer_bindings (id uuid, subject_user_id text)`);
      await expect(migrate(drizzle(h.migration), { migrationsFolder: migrations })).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/payer_bindings exists with an unexpected shape/) },
      });
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

// The credential adoption gate: the package's own rows over the adopted SQL store. Red runs them as the BYPASSRLS service role (the store's role);
// the rows below prove the app role is walled off and a store on the wrong role is unavailable, never "never confirmed".
let credService: postgres.Sql;
let credApp: postgres.Sql;
const credentialStore = (sql: postgres.Sql) =>
  createPostgresCredentialStore(sql as unknown as CredentialSql, { hasRoles: agentRolesHasRoles(sql as unknown as CredentialSql) });
async function makeCredUser(opts: { human?: boolean; internal?: boolean } = {}) {
  const id = randomUUID();
  await credService`INSERT INTO users(id,name) VALUES (${id}, ${`cred-${id.slice(0, 6)}`})`;
  if (opts.internal)
    await credService`INSERT INTO agent_principals(kind,slug,user_id) VALUES ('internal', ${`conf-${id}`}, ${id})`;
  else if (!opts.human) await credService`INSERT INTO agent_principals(kind,user_id) VALUES ('external', ${id})`;
  return id;
}
runCredentialConformance({
  describe,
  it: (name, run) =>
    it(name, () =>
      fixture(async ({ app, service, adopt }) => {
        await adopt();
        credService = service;
        credApp = app;
        await run();
      }),
    ),
  expect,
  async setup(facts) {
    const ids: Record<string, string> = {};
    for (const [name, f] of Object.entries(facts)) {
      const id = await makeCredUser({ human: f.human === true, internal: f.internal === true });
      ids[name] = id;
      const admin = f.roles ? await makeCredUser() : null;
      if (f.wallet) {
        const wallet = `0x${randomUUID().replaceAll("-", "").padEnd(40, "0").slice(0, 40)}`;
        await credService`INSERT INTO user_bindings(id,user_id,provider,external_id) VALUES (${randomUUID()}, ${id}, 'wallet', ${wallet})`;
        if (f.human) await credService`UPDATE users SET wallet_address = ${wallet} WHERE id = ${id}`;
      }
      if (f.roles)
        await credService`INSERT INTO agent_roles(principal_user_id,scope,approved_by,granted_at) VALUES (${id}, 'probe:scope', ${admin}, now())`;
      if (f.github)
        await credService`INSERT INTO user_bindings(id,user_id,provider,external_id) VALUES (${randomUUID()}, ${id}, 'github', ${`gh-${randomUUID()}`})`;
    }
    return { store: credentialStore(credService), ids };
  },
  async age(credentialId, to) {
    if (to === "pending_expired")
      await credService`UPDATE agent_credentials SET pending_expires_at = now() - interval '1 second' WHERE id = ${credentialId}`;
    else if (to === "renew_only")
      await credService`UPDATE agent_credentials SET expires_at = now() - interval '1 hour', renew_until = now() + interval '1 day' WHERE id = ${credentialId}`;
    else
      await credService`UPDATE agent_credentials SET expires_at = now() - interval '2 hour', renew_until = now() - interval '1 minute' WHERE id = ${credentialId}`;
  },
  async addRoles(userId) {
    const admin = await makeCredUser();
    await credService`INSERT INTO agent_roles(principal_user_id,scope,approved_by,granted_at) VALUES (${userId}, 'probe:scope', ${admin}, now())`;
  },
  broken: () =>
    createPostgresCredentialStore(
      (async () => {
        throw new Error("db down");
      }) as unknown as CredentialSql,
      { hasRoles: async () => false },
    ),
  storedHash: async (credentialId) =>
    (await credService`SELECT token_hash FROM agent_credentials WHERE id = ${credentialId}`)[0]?.token_hash ?? null,
  liveSuccessors: async (predecessorId) =>
    (
      await credService`SELECT count(*)::int AS n FROM agent_credentials WHERE predecessor_id = ${predecessorId} AND confirmed_at IS NULL AND revoked_at IS NULL`
    )[0]?.n ?? 0,
});

describe("agent credentials: rows only the adopted SQL can prove", () => {
  it("the app role sees no credential row (FORCE RLS, no policy), cannot write one, and a store on that role is unavailable, never 'never confirmed'", async () => {
    await fixture(async ({ app, service, adopt }) => {
      await adopt();
      credService = service;
      const user = await makeCredUser();
      const key = await upgradeSignedKey(credentialStore(service), { userId: user });
      if (!key.ok) throw new Error(`refused: ${key.reason}`);
      await confirmCredential(credentialStore(service), { credentialId: key.credentialId });
      expect(await app`SELECT 1 FROM agent_credentials`).toHaveLength(0);
      await expect(
        app`INSERT INTO agent_credentials(user_id,token_hash,created_from,expires_at,renew_until) VALUES (${user}, 'x', 'rotation', now(), now() + interval '1 day')`,
      ).rejects.toThrow();
      const wrongRole = createPostgresCredentialStore(app as unknown as CredentialSql, { hasRoles: async () => false });
      await expect(assertV1NotSuperseded(wrongRole, user)).rejects.toMatchObject({ code: "authz_unavailable" });
      expect(await verifyBearer(wrongRole, key.apiKey)).toEqual({ ok: false, reason: "unavailable" });
      await expect(assertV1NotSuperseded(credentialStore(service), user)).rejects.toMatchObject({ code: "v1_superseded" });
    });
  });

  it("only a user with an EXTERNAL agent principal may hold a credential (trigger)", async () => {
    await fixture(async ({ service, adopt }) => {
      await adopt();
      credService = service;
      const plain = await makeCredUser({ human: true });
      const insert = (userId: string) =>
        service`INSERT INTO agent_credentials(user_id,token_hash,created_from,expires_at,renew_until) VALUES (${userId}, ${randomUUID()}, 'key_upgrade', now() + interval '1 day', now() + interval '2 day')`;
      await expect(insert(plain)).rejects.toThrow(/requires an external agent principal/);
      await expect(insert(nodeAi)).rejects.toThrow(/requires an external agent principal/);
    });
  });
});
