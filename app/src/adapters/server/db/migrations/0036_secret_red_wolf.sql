-- story.0090: separately generated additive 0.8.1 target; no capability is approved.
-- Baseline helpers are session-local in the same locked migration transaction.
-- Only the exact superseded #366 definition may be retired (source 803a05b0).
SELECT pg_temp.authority_constraint('agent_roles', 'agent_roles_owner_shape', $ddl$ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_owner_shape" CHECK (("agent_roles"."resource_kind" = 'node') = ("agent_roles"."owner_user_id" IS NULL))$ddl$, true);
--> statement-breakpoint
ALTER TABLE "agent_roles" DROP CONSTRAINT IF EXISTS "agent_roles_owner_shape";
--> statement-breakpoint
-- Only the exact superseded #366 definition may be retired (source 803a05b0).
SELECT pg_temp.authority_constraint('agent_roles', 'agent_roles_personal_approver', $ddl$ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_personal_approver" CHECK ("agent_roles"."resource_kind" = 'node' OR "agent_roles"."approved_by" IS NULL OR ("agent_roles"."approved_by" = "agent_roles"."owner_user_id" AND "agent_roles"."approved_by" <> "agent_roles"."principal_user_id" AND "agent_roles"."expires_at" IS NOT NULL))$ddl$, true);
--> statement-breakpoint
ALTER TABLE "agent_roles" DROP CONSTRAINT IF EXISTS "agent_roles_personal_approver";
--> statement-breakpoint
-- Only the exact superseded #366 definition may be retired (source 803a05b0).
SELECT pg_temp.authority_constraint('agent_roles', 'agent_roles_personal_scope_delegable', $ddl$ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_personal_scope_delegable" CHECK ("agent_roles"."resource_kind" = 'node' OR "agent_roles"."scope" IN ('knowledge:read','knowledge:contribute'))$ddl$, true);
--> statement-breakpoint
ALTER TABLE "agent_roles" DROP CONSTRAINT IF EXISTS "agent_roles_personal_scope_delegable";
--> statement-breakpoint
-- Only the exact superseded #366 definition may be retired (source 803a05b0).
SELECT pg_temp.authority_constraint('agent_roles', 'agent_roles_resource_kind_canonical', $ddl$ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_resource_kind_canonical" CHECK ("agent_roles"."resource_kind" IN ('node','delegated'))$ddl$, true);
--> statement-breakpoint
ALTER TABLE "agent_roles" DROP CONSTRAINT IF EXISTS "agent_roles_resource_kind_canonical";
--> statement-breakpoint
ALTER TABLE "agent_roles" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.agent_roles'::regclass AND attname = 'resource_kind' AND NOT attisdropped) THEN
    IF EXISTS (SELECT 1 FROM agent_roles WHERE resource_kind NOT IN ('node','delegated')) THEN
      RAISE EXCEPTION 'unknown historical authority resource_kind';
    END IF;
    -- A delegated row can never become live node authority through DEFAULT 'node'.
    UPDATE agent_roles SET revoked_at = coalesce(revoked_at, now()) WHERE resource_kind = 'delegated';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN IF NOT EXISTS "resource" text DEFAULT 'node' NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN IF NOT EXISTS "account_id" text;
--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN IF NOT EXISTS "link_hash" text;
--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN IF NOT EXISTS "link_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_roles" ADD COLUMN IF NOT EXISTS "link_consumed_at" timestamp with time zone;
--> statement-breakpoint
SELECT pg_temp.authority_constraint('agent_roles', 'agent_roles_account_id_billing_accounts_id_fk', $ddl$ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE no action ON UPDATE no action$ddl$);
--> statement-breakpoint
SELECT pg_temp.authority_index('agent_roles', 'agent_roles_link_hash_unique', ARRAY['link_hash']::text[], true, '', $ddl$CREATE UNIQUE INDEX "agent_roles_link_hash_unique" ON "agent_roles" USING btree ("link_hash")$ddl$);
--> statement-breakpoint
SELECT pg_temp.authority_constraint('agent_roles', 'agent_roles_resource_canonical', $ddl$ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_resource_canonical" CHECK ("agent_roles"."resource" IN ('node','account'))$ddl$);
--> statement-breakpoint
UPDATE "agent_roles" SET "expires_at" = NULL WHERE "expires_at" IS NOT NULL AND "resource" = 'node';
--> statement-breakpoint
SELECT pg_temp.authority_constraint('agent_roles', 'agent_roles_node_shape', $ddl$ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_node_shape" CHECK ("agent_roles"."resource" <> 'node' OR ("agent_roles"."account_id" IS NULL AND "agent_roles"."expires_at" IS NULL))$ddl$);
--> statement-breakpoint
SELECT pg_temp.authority_constraint('agent_roles', 'agent_roles_account_live_shape', $ddl$ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_account_live_shape" CHECK ("agent_roles"."resource" <> 'account' OR "agent_roles"."approved_by" IS NULL OR ("agent_roles"."account_id" IS NOT NULL AND "agent_roles"."granted_at" IS NOT NULL AND ("agent_roles"."expires_at" IS NULL OR "agent_roles"."expires_at" > "agent_roles"."granted_at")))$ddl$);
--> statement-breakpoint
SELECT pg_temp.authority_constraint('agent_roles', 'agent_roles_no_self_approval', $ddl$ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_no_self_approval" CHECK ("agent_roles"."approved_by" IS NULL OR "agent_roles"."approved_by" <> "agent_roles"."principal_user_id")$ddl$);
--> statement-breakpoint
SELECT pg_temp.authority_constraint('agent_roles', 'agent_roles_link_consumed_has_no_hash', $ddl$ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_link_consumed_has_no_hash" CHECK ("agent_roles"."link_consumed_at" IS NULL OR "agent_roles"."link_hash" IS NULL)$ddl$);
--> statement-breakpoint
DO $$
DECLARE previous text;
BEGIN
  SELECT pg_get_expr(polqual, polrelid) INTO previous FROM pg_policy
    WHERE polrelid = 'public.agent_roles'::regclass AND polname = 'agent_roles_account_self_read';
  IF FOUND THEN
    IF previous IS NULL THEN RAISE EXCEPTION 'unsafe account self-read policy'; END IF;
    EXECUTE format('ALTER POLICY agent_roles_account_self_read ON public.agent_roles USING ((%s) AND (resource = %L AND principal_user_id = current_setting(%L, true)))', previous, 'account', 'app.current_user_id');
  ELSE
    CREATE POLICY "agent_roles_account_self_read" ON "agent_roles" AS PERMISSIVE FOR SELECT TO public USING ("agent_roles"."resource" = 'account' AND "agent_roles"."principal_user_id" = current_setting('app.current_user_id', true));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "agent_roles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- CURRENT_USER was explicitly resolved to users' non-bypass app owner in 0035.
GRANT SELECT ON "agent_principals", "agent_roles" TO CURRENT_USER;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION agent_has_scope(p_account_id text, p_scope text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.agent_roles r
    WHERE r.resource = 'account'
      AND r.principal_user_id = current_setting('app.current_user_id', true)
      AND r.scope = p_scope
      AND r.account_id = p_account_id
      AND r.approved_by IS NOT NULL
      AND r.revoked_at IS NULL
      AND (r.expires_at IS NULL OR r.expires_at > now())
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION agent_has_scope(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION agent_has_scope(text, text) TO CURRENT_USER;--> statement-breakpoint
-- Preserve any narrower existing account-table policy while requiring the
-- released durable predicate. Owner policies on these tables remain unchanged.
DO $$
DECLARE tab text; col text; previous text; cmd "char";
BEGIN
  FOREACH tab IN ARRAY ARRAY['billing_accounts','credit_ledger'] LOOP
    col := CASE tab WHEN 'billing_accounts' THEN 'id' ELSE 'billing_account_id' END;
    SELECT pg_get_expr(polqual, polrelid), polcmd INTO previous, cmd FROM pg_policy
      WHERE polrelid = to_regclass('public.' || tab) AND polname = 'agent_delegated_read';
    IF FOUND THEN
      IF cmd <> 'r' OR previous IS NULL THEN RAISE EXCEPTION 'unsafe delegated policy on %', tab; END IF;
      EXECUTE format('ALTER POLICY agent_delegated_read ON public.%I USING ((%s) AND public.agent_has_scope(%I, %L))', tab, previous, col, 'account:read');
    ELSE
      EXECUTE format('CREATE POLICY agent_delegated_read ON public.%I AS PERMISSIVE FOR SELECT TO public USING (public.agent_has_scope(%I, %L))', tab, col, 'account:read');
    END IF;
  END LOOP;
END $$;
