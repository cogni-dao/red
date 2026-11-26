-- story.0090: adopt only the released authority shape. Ordinary DDL below is
-- generated from this node's schema; catalog guards are not expressible in Drizzle.
-- The runner encloses the batch in a transaction. Resolve the actual object owner:
-- CURRENT_USER is the isolated migrator, never the runtime application role.
DO $$
DECLARE owner_name text;
BEGIN
  SELECT r.rolname INTO owner_name FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
  WHERE c.oid = 'public.users'::regclass AND NOT r.rolsuper AND NOT r.rolbypassrls;
  IF owner_name IS NULL OR NOT pg_has_role(current_user, owner_name, 'MEMBER') THEN
    RAISE EXCEPTION 'authority adoption requires membership in the non-bypass users owner';
  END IF;
  EXECUTE format('SET LOCAL ROLE %I', owner_name);
END $$;
--> statement-breakpoint
-- All helpers are session-local, not application runtime DDL.
CREATE OR REPLACE FUNCTION pg_temp.authority_columns(tab text, spec jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE col record; wanted jsonb; actual_default text;
BEGIN
  IF to_regclass('public.' || tab) IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.' || tab)
    AND relkind = 'r' AND relowner = current_user::regrole AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION 'incompatible authority table ownership or RLS: %', tab;
  END IF;
  FOR col IN SELECT a.*, format_type(a.atttypid, a.atttypmod) AS type,
      pg_get_expr(d.adbin, d.adrelid) AS def
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = to_regclass('public.' || tab) AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    wanted := spec -> col.attname;
    IF wanted IS NULL OR col.type <> wanted->>0 OR col.attnotnull <> (wanted->>1)::boolean
       OR col.attgenerated <> '' OR col.attidentity <> ''
       OR col.attcollation <> (SELECT typcollation FROM pg_type WHERE oid = col.atttypid) THEN
      RAISE EXCEPTION 'incompatible authority column: %.%', tab, col.attname;
    END IF;
    actual_default := coalesce(col.def, '');
    IF actual_default <> coalesce(wanted->>3, '') THEN
      RAISE EXCEPTION 'incompatible authority default: %.%', tab, col.attname;
    END IF;
  END LOOP;
  FOR col IN SELECT key AS name, value FROM jsonb_each(spec) LOOP
    IF (col.value->>2)::boolean AND NOT EXISTS (SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass('public.' || tab) AND attname = col.name AND attnum > 0 AND NOT attisdropped) THEN
      RAISE EXCEPTION 'missing authority baseline column: %.%', tab, col.name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.' || tab)
    AND c.contype = 'p' AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
      WHERE attrelid = c.conrelid AND attname = 'id')]::smallint[] AND NOT c.condeferrable) THEN
    RAISE EXCEPTION 'incompatible authority primary key: %', tab;
  END IF;
  IF tab = 'agent_roles' AND NOT EXISTS (SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass('public.' || tab) AND attname IN ('resource','resource_kind') AND NOT attisdropped)
    AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.' || tab)
      AND attname IN ('owner_user_id','account_id','expires_at','link_hash','link_expires_at','link_consumed_at') AND NOT attisdropped) THEN
    RAISE EXCEPTION 'unknown authority legacy resource shape';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass('public.' || tab) AND c.contype = 'f'
    AND (cardinality(c.conkey) <> 1 OR NOT EXISTS (
      SELECT 1 FROM pg_attribute a JOIN pg_attribute ref ON ref.attrelid = c.confrelid AND ref.attnum = c.confkey[1]
      WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1] AND ref.attname = 'id'
        AND ((a.attname IN ('user_id','principal_user_id','approved_by','requested_by','owner_user_id') AND c.confrelid = 'public.users'::regclass)
          OR (a.attname = 'account_id' AND c.confrelid = 'public.billing_accounts'::regclass))))) THEN
    RAISE EXCEPTION 'incompatible authority foreign key shape: %', tab;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.' || tab) AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'unknown authority trigger: %', tab;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = to_regclass('public.' || tab)
    AND (polcmd <> 'r' OR (polpermissive AND polname <> CASE tab WHEN 'agent_principals' THEN 'agent_principals_read' ELSE 'agent_roles_account_self_read' END))) THEN
    RAISE EXCEPTION 'unknown authority security policy: %', tab;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.authority_constraint(tab text, cname text, ddl text, validate_only boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE expected text; actual text; fk text[]; source_col smallint; target_col smallint; target_table regclass; source_force boolean; target_force boolean;
BEGIN
  IF validate_only AND NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = to_regclass('public.' || tab) AND conname = cname) THEN RETURN; END IF;
  IF position('FOREIGN KEY' IN ddl) > 0 THEN
    fk := regexp_match(ddl, 'FOREIGN KEY \("([^" ]+)"\) REFERENCES "public"\."([^" ]+)"\("([^" ]+)"\)');
    IF fk IS NULL THEN RAISE EXCEPTION 'unsupported generated authority foreign key'; END IF;
    SELECT attnum INTO source_col FROM pg_attribute WHERE attrelid = to_regclass('public.' || tab) AND attname = fk[1];
    target_table := to_regclass('public.' || fk[2]);
    SELECT attnum INTO target_col FROM pg_attribute WHERE attrelid = target_table AND attname = fk[3];
    IF EXISTS (SELECT 1 FROM pg_constraint c WHERE conrelid = to_regclass('public.' || tab)
      AND ((contype = 'f' AND source_col = ANY(conkey)) OR conname = cname)
      AND NOT (contype = 'f' AND conkey = ARRAY[source_col] AND confrelid = target_table AND confkey = ARRAY[target_col]
        AND confdeltype = 'a' AND confupdtype = 'a' AND confmatchtype = 's' AND convalidated AND NOT condeferrable)) THEN
      RAISE EXCEPTION 'incompatible authority foreign key: %.%', tab, cname;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.' || tab) AND conname = cname) THEN
      -- Existing account rows must be validated as their object owner, not
      -- hidden by FORCE RLS on either side of the FK. The runner transaction
      -- holds these DDL locks; no app session sees the temporary owner bypass.
      SELECT relforcerowsecurity INTO source_force FROM pg_class WHERE oid = to_regclass('public.' || tab);
      SELECT relforcerowsecurity INTO target_force FROM pg_class WHERE oid = target_table;
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', tab);
      EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', target_table);
      EXECUTE ddl;
      IF source_force THEN EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tab); END IF;
      IF target_force THEN EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target_table); END IF;
    END IF;
    RETURN;
  END IF;
  -- Let Postgres canonicalize generated CHECK expressions, not string guesses.
  EXECUTE format('CREATE TEMP TABLE authority_expected (LIKE public.%I)', tab);
  EXECUTE replace(replace(ddl, 'ALTER TABLE "' || tab || '"', 'ALTER TABLE pg_temp.authority_expected'), '"' || tab || '".', '');
  SELECT pg_get_constraintdef(oid) INTO expected FROM pg_constraint
    WHERE conrelid = 'pg_temp.authority_expected'::regclass AND conname = cname;
  SELECT pg_get_constraintdef(oid) INTO actual FROM pg_constraint
    WHERE conrelid = to_regclass('public.' || tab) AND conname = cname;
  IF FOUND THEN
    IF actual IS DISTINCT FROM expected THEN
      RAISE EXCEPTION 'incompatible authority constraint: %.%: actual %, required %', tab, cname, actual, expected;
    END IF;
  ELSIF NOT validate_only THEN
    EXECUTE ddl;
  END IF;
  DROP TABLE pg_temp.authority_expected;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.authority_index(tab text, iname text, cols text[], uniq boolean, pred text, ddl text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass('public.' || iname) IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_am am ON am.oid = c.relam
      WHERE i.indexrelid = to_regclass('public.' || iname) AND i.indrelid = to_regclass('public.' || tab)
      AND i.indisunique = uniq AND i.indisvalid AND i.indisready AND am.amname = 'btree'
      AND i.indexprs IS NULL AND i.indnkeyatts = i.indnatts AND NOT i.indnullsnotdistinct
      AND NOT EXISTS (SELECT 1 FROM unnest(i.indoption) opt WHERE opt <> 0)
      AND NOT EXISTS (SELECT 1 FROM unnest(i.indclass) cls JOIN pg_opclass op ON op.oid = cls WHERE NOT op.opcdefault)
      AND NOT EXISTS (SELECT 1 FROM unnest(i.indcollation) coll WHERE coll NOT IN (0, 'default'::regcollation))
      AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(num, ord)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.num ORDER BY k.ord) = cols
      AND coalesce(pg_get_expr(i.indpred, i.indrelid), '') = pred) THEN
      RAISE EXCEPTION 'incompatible authority index: %', iname;
    END IF;
  ELSE EXECUTE ddl;
  END IF;
END $$;
--> statement-breakpoint
SELECT pg_temp.authority_columns('agent_principals', $spec${"id": ["uuid", true, true, "gen_random_uuid()"], "kind": ["text", true, true], "slug": ["text", false, true], "user_id": ["text", true, true], "created_at": ["timestamp with time zone", true, true, "now()"], "owner_user_id": ["text", false, false]}$spec$::jsonb);
--> statement-breakpoint
SELECT pg_temp.authority_columns('agent_roles', $spec${"id": ["uuid", true, true, "gen_random_uuid()"], "principal_user_id": ["text", true, true], "scope": ["text", true, true], "approved_by": ["text", false, true], "granted_at": ["timestamp with time zone", false, true], "requested_by": ["text", false, true], "created_at": ["timestamp with time zone", true, true, "now()"], "revoked_at": ["timestamp with time zone", false, true], "owner_user_id": ["text", false, false], "resource_kind": ["text", true, false, "'node'::text"], "resource": ["text", true, false, "'node'::text"], "account_id": ["text", false, false], "expires_at": ["timestamp with time zone", false, false], "link_hash": ["text", false, false], "link_expires_at": ["timestamp with time zone", false, false], "link_consumed_at": ["timestamp with time zone", false, false]}$spec$::jsonb);
--> statement-breakpoint
-- Additional legacy CHECKs only restrict writes. Keep their exact definitions,
-- validation state and identity: Postgres intersects them with the required
-- canonical CHECKs below and in 0036. Never infer authority from a CHECK name.
-- Other unknown shapes (columns, ownership, keys, policies, triggers) still fail.
SELECT set_config('red.authority_fresh_principals', (to_regclass('public.agent_principals') IS NULL)::text, true);
--> statement-breakpoint
DO $$ BEGIN IF to_regclass('public.agent_principals') IS NULL THEN
CREATE TABLE "agent_principals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"slug" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_principals_kind_canonical" CHECK ("agent_principals"."kind" IN ('internal','external')),
	CONSTRAINT "agent_principals_internal_has_slug" CHECK ("agent_principals"."kind" <> 'internal' OR "agent_principals"."slug" IS NOT NULL)
);
END IF; END $$;
--> statement-breakpoint
ALTER TABLE "agent_principals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN IF to_regclass('public.agent_roles') IS NULL THEN
CREATE TABLE "agent_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_user_id" text NOT NULL,
	"scope" text NOT NULL,
	"approved_by" text,
	"granted_at" timestamp with time zone,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
END IF; END $$;
--> statement-breakpoint
ALTER TABLE "agent_roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT pg_temp.authority_constraint('agent_principals', 'agent_principals_user_id_users_id_fk', $ddl$ALTER TABLE "agent_principals" ADD CONSTRAINT "agent_principals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action$ddl$);
--> statement-breakpoint
SELECT pg_temp.authority_constraint('agent_roles', 'agent_roles_principal_user_id_users_id_fk', $ddl$ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_principal_user_id_users_id_fk" FOREIGN KEY ("principal_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action$ddl$);
--> statement-breakpoint
SELECT pg_temp.authority_constraint('agent_roles', 'agent_roles_approved_by_users_id_fk', $ddl$ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action$ddl$);
--> statement-breakpoint
SELECT pg_temp.authority_constraint('agent_roles', 'agent_roles_requested_by_users_id_fk', $ddl$ALTER TABLE "agent_roles" ADD CONSTRAINT "agent_roles_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action$ddl$);
--> statement-breakpoint
SELECT pg_temp.authority_index('agent_principals', 'agent_principals_slug_unique', ARRAY['slug']::text[], true, '', $ddl$CREATE UNIQUE INDEX "agent_principals_slug_unique" ON "agent_principals" USING btree ("slug")$ddl$);
--> statement-breakpoint
SELECT pg_temp.authority_index('agent_principals', 'agent_principals_user_id_unique', ARRAY['user_id']::text[], true, '', $ddl$CREATE UNIQUE INDEX "agent_principals_user_id_unique" ON "agent_principals" USING btree ("user_id")$ddl$);
--> statement-breakpoint
SELECT pg_temp.authority_index('agent_roles', 'agent_roles_live_unique', ARRAY['principal_user_id', 'scope']::text[], true, '(revoked_at IS NULL)', $ddl$CREATE UNIQUE INDEX "agent_roles_live_unique" ON "agent_roles" USING btree ("principal_user_id","scope") WHERE "agent_roles"."revoked_at" IS NULL$ddl$);
--> statement-breakpoint
SELECT pg_temp.authority_index('agent_roles', 'agent_roles_principal_idx', ARRAY['principal_user_id']::text[], false, '', $ddl$CREATE INDEX "agent_roles_principal_idx" ON "agent_roles" USING btree ("principal_user_id")$ddl$);
--> statement-breakpoint
DO $$ BEGIN IF current_setting('red.authority_fresh_principals')::boolean THEN
CREATE POLICY "agent_principals_read" ON "agent_principals" AS PERMISSIVE FOR SELECT TO public USING (true);
END IF; END $$;
--> statement-breakpoint
SELECT pg_temp.authority_constraint('agent_principals', 'agent_principals_kind_canonical', $ddl$ALTER TABLE "agent_principals" ADD CONSTRAINT "agent_principals_kind_canonical" CHECK ("agent_principals"."kind" IN ('internal','external'))$ddl$);
--> statement-breakpoint
SELECT pg_temp.authority_constraint('agent_principals', 'agent_principals_internal_has_slug', $ddl$ALTER TABLE "agent_principals" ADD CONSTRAINT "agent_principals_internal_has_slug" CHECK ("agent_principals"."kind" <> 'internal' OR "agent_principals"."slug" IS NOT NULL)$ddl$);
--> statement-breakpoint
ALTER TABLE "agent_principals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agent_roles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Seed identity only. A collision with a human or another principal aborts adoption.
SELECT set_config('app.current_user_id', '00000000-0000-4000-a000-0000000a0001', true);
--> statement-breakpoint
INSERT INTO "users" ("id", "name", "wallet_address")
VALUES ('00000000-0000-4000-a000-0000000a0001', 'node-ai', NULL) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "agent_principals" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = '00000000-0000-4000-a000-0000000a0001'
    AND name = 'node-ai' AND wallet_address IS NULL AND email IS NULL)
    OR EXISTS (SELECT 1 FROM agent_principals WHERE (slug = 'node-ai' OR user_id = '00000000-0000-4000-a000-0000000a0001')
      AND (kind <> 'internal' OR slug IS DISTINCT FROM 'node-ai' OR user_id <> '00000000-0000-4000-a000-0000000a0001')) THEN
    RAISE EXCEPTION 'canonical node-ai identity collision';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO "agent_principals" ("kind", "slug", "user_id")
VALUES ('internal', 'node-ai', '00000000-0000-4000-a000-0000000a0001') ON CONFLICT ("user_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "agent_principals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT set_config('app.current_user_id', '', true);
