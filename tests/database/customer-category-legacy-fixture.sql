-- FICTIONAL LEGACY TEST CONTRACT. Never a production export or rollout baseline.
-- Load only into the separate, freshly created PostgreSQL 17 disposable database.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL idle_in_transaction_session_timeout='60s';
SET LOCAL search_path='';
SET LOCAL row_security=off;
DO $legacy_seed_guard$
BEGIN
 IF current_database()<>'pilot_category_legacy_test' OR current_user<>'postgres'
 THEN RAISE EXCEPTION 'Dedicated disposable legacy database and postgres owner required'; END IF;
 IF pg_catalog.to_regclass('public.customers') IS NOT NULL
 OR pg_catalog.to_regclass('public.pilot_fixture_marker') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='pricing_tier')
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname='extensions')
 THEN RAISE EXCEPTION 'Fresh disposable legacy database required'; END IF;
END $legacy_seed_guard$;

CREATE SCHEMA extensions AUTHORIZATION postgres;
CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;
DO $legacy_roles$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $legacy_roles$;
CREATE TABLE public.pilot_fixture_marker(purpose text PRIMARY KEY);
INSERT INTO public.pilot_fixture_marker VALUES('disposable-pilot-ci');
DO $legacy_marker$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 THEN RAISE EXCEPTION 'Disposable legacy marker required'; END IF;
END $legacy_marker$;
CREATE TYPE public.pricing_tier AS ENUM ('harga_pokok','luar_kota','dalam_kota','depo_bangunan','others');
CREATE TABLE public.customers (
 id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
 name text NOT NULL,
 phone text,
 email text,
 created_at timestamptz NOT NULL DEFAULT now(),
 address text,
 visit_frequency_days integer NOT NULL DEFAULT 7,
 last_visit_date date,
 city text,
 pricing_tier public.pricing_tier NOT NULL DEFAULT 'luar_kota',
 CONSTRAINT suppliers_pkey PRIMARY KEY (id)
);
ALTER TABLE public.customers OWNER TO postgres;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
GRANT ALL PRIVILEGES ON TABLE public.customers TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.customers TO authenticated;
-- Synthetic policies make the migration's exact policy snapshot nonempty.
CREATE POLICY legacy_fixture_read ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY legacy_fixture_insert ON public.customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY legacy_fixture_update ON public.customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
INSERT INTO public.customers(id,name,phone,email,created_at,address,visit_frequency_days,last_visit_date,city,pricing_tier) VALUES
 ('96000000-0000-0000-0001-000000000001','Synthetic legacy original Others','000-001','legacy-one@example.invalid','2026-08-01T00:00:00Z','Fictional original road',14,'2026-08-20','Synthetic original city','others'),
 ('96000000-0000-0000-0001-000000000002','Synthetic legacy original nullable fields',NULL,NULL,'2026-08-02T00:00:00Z',NULL,7,NULL,NULL,'luar_kota');

-- Retained only in this dedicated synthetic database, to compare rollback state.
CREATE TABLE public.category_legacy_fixture_baseline(singleton boolean PRIMARY KEY CHECK (singleton),state jsonb NOT NULL);
INSERT INTO public.category_legacy_fixture_baseline
SELECT true,jsonb_build_object(
 'rows',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.customers c),
 'relation',(SELECT jsonb_build_array(c.oid,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.relispartition) FROM pg_catalog.pg_class c WHERE c.oid='public.customers'::regclass),
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attnum,to_jsonb(a),pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
  FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.customers'::regclass AND a.attnum>0),
 'constraints',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.oid) FROM pg_catalog.pg_constraint k WHERE k.conrelid='public.customers'::regclass),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_policy p WHERE p.polrelid='public.customers'::regclass)
);
COMMIT;
