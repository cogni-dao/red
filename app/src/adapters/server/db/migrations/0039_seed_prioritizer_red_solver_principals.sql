-- story.0090: seed the two internal principals the shared in-process provider's principal lock needs.
-- The provider looks up each catalog graph's principal slug before any tool runs and denies the run when no seed row exists (SCOPED_TOOL_NEEDS_PRINCIPAL).
--   - prioritizer: named by the published work-prioritizer entry. Red seeded only node-ai (0035), because its old runner ignored the catalog principal.
--     Id and slug match INTERNAL_AGENT_PRINCIPALS in @cogni-dao/agent-grants (migrations/agent_authority.sql).
--   - red-solver: Red's own graph. Node-owned id, outside the package's a0001..a0002 range. It holds no role row until a node admin turns red:http_request (and, for the shell, sandbox:exec) On.
-- Seed identity only: no wallet, no credential, no role row. Same role handling as 0035/0038: act as the non-bypass owner of public.users.
DO $$
DECLARE owner_name text;
BEGIN
  SELECT r.rolname INTO owner_name FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
  WHERE c.oid = 'public.users'::regclass AND NOT r.rolsuper AND NOT r.rolbypassrls;
  IF owner_name IS NULL OR NOT pg_has_role(current_user, owner_name, 'MEMBER') THEN
    RAISE EXCEPTION 'principal seed requires membership in the non-bypass users owner';
  END IF;
  EXECUTE format('SET LOCAL ROLE %I', owner_name);
END $$;
--> statement-breakpoint
-- `users` has FORCE RLS (self_isolation: id = app.current_user_id): set the RLS context to each principal before its insert (transaction-local).
SELECT set_config('app.current_user_id', '00000000-0000-4000-a000-0000000a0002', true);
--> statement-breakpoint
INSERT INTO "users" ("id", "name", "wallet_address")
VALUES ('00000000-0000-4000-a000-0000000a0002', 'prioritizer', NULL) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
SELECT set_config('app.current_user_id', '00000000-0000-4000-a000-0000000b0001', true);
--> statement-breakpoint
INSERT INTO "users" ("id", "name", "wallet_address")
VALUES ('00000000-0000-4000-a000-0000000b0001', 'red-solver', NULL) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- agent_principals is FORCE RLS with a select-only policy, so even its owner cannot INSERT: lift FORCE for the seed only, inside the migration transaction.
ALTER TABLE "agent_principals" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A collision with a human or another principal aborts the seed.
DO $$
DECLARE seed record;
BEGIN
  FOR seed IN SELECT * FROM (VALUES
    ('prioritizer', '00000000-0000-4000-a000-0000000a0002'),
    ('red-solver', '00000000-0000-4000-a000-0000000b0001')
  ) AS v(slug, user_id) LOOP
    -- `users` is FORCE RLS: read each principal's own row under its own context.
    PERFORM set_config('app.current_user_id', seed.user_id, true);
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = seed.user_id
      AND name = seed.slug AND wallet_address IS NULL AND email IS NULL)
      OR EXISTS (SELECT 1 FROM agent_principals WHERE (slug = seed.slug OR user_id = seed.user_id)
        AND (kind <> 'internal' OR slug IS DISTINCT FROM seed.slug OR user_id <> seed.user_id)) THEN
      RAISE EXCEPTION 'internal principal identity collision: %', seed.slug;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO "agent_principals" ("kind", "slug", "user_id")
VALUES ('internal', 'prioritizer', '00000000-0000-4000-a000-0000000a0002') ON CONFLICT ("user_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "agent_principals" ("kind", "slug", "user_id")
VALUES ('internal', 'red-solver', '00000000-0000-4000-a000-0000000b0001') ON CONFLICT ("user_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "agent_principals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT set_config('app.current_user_id', '', true);
