-- Synthetic read suite, authored but not executed by the read worker.
-- Runtime coordinator: inside one verified rollback-only fixture transaction,
-- apply public source composition + 01-foundation.sql + 05-reads.sql first.
-- No production rows, hosted data, readiness change or durable application.
CREATE FUNCTION pg_temp.catalogue_read_assert(ok boolean, label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Catalogue read assertion failed: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.catalogue_read_raises(statement text, expected_state text, label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE actual text;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual = RETURNED_SQLSTATE; END;
  IF actual IS DISTINCT FROM expected_state THEN RAISE EXCEPTION '%: expected %, got %', label, expected_state, coalesce(actual, 'success'); END IF;
END $$;
DO $$ DECLARE ns text; BEGIN
  SELECT nspname INTO STRICT ns FROM pg_namespace WHERE oid = pg_my_temp_schema();
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO authenticated, anon', ns);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.catalogue_read_assert(boolean,text) FROM PUBLIC', ns);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.catalogue_read_raises(text,text,text) FROM PUBLIC', ns);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.catalogue_read_assert(boolean,text) TO authenticated, anon', ns);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.catalogue_read_raises(text,text,text) TO authenticated, anon', ns);
END $$;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000000101'), ('00000000-0000-4000-8000-000000000102');
INSERT INTO public.users(id,full_name,email,role,is_active) VALUES
 ('00000000-0000-4000-8000-000000000101','Fictional catalogue reader','reader@example.invalid','co_admin',true),
 ('00000000-0000-4000-8000-000000000102','Fictional empty reader','empty-reader@example.invalid','executive',true);
-- Trusted synthetic retained identity exercises text fidelity without weakening
-- server version guards. The actual INSERT advances from this retained version.
INSERT INTO private.catalog_identity_v1(kind,id,lifetime_state,last_version,deleted_at)
VALUES ('product','00000000-0000-4000-8000-000000000201','unknown',9007199254740992,NULL);
INSERT INTO public.products(id,name,sku,size,unit_price,harga_pokok,luar_kota,dalam_kota,depo_bangunan) VALUES
 ('00000000-0000-4000-8000-000000000201','Catalogue Read 100%_literal','READ-201',NULL,NULL,0,NULL,NULL,NULL),
 ('00000000-0000-4000-8000-000000000202','Catalogue Read 100XYliteral','READ-202','Small',1,1,2,3,4),
 ('00000000-0000-4000-8000-000000000203','Catalogue Read disabled history','READ-203',NULL,NULL,NULL,NULL,NULL,NULL);
UPDATE public.products SET is_enabled=false WHERE id='00000000-0000-4000-8000-000000000203';
INSERT INTO public.customers(id,name,address,city,phone,email,pricing_tier,customer_category) VALUES
 ('00000000-0000-4000-8000-000000000301','Catalogue Read customer 1',NULL,'Fictional City',NULL,NULL,'others','perorangan'),
 ('00000000-0000-4000-8000-000000000302','Catalogue Read customer 2','Fictional Street',NULL,NULL,'fictional@example.invalid','luar_kota','perorangan');
UPDATE public.customers SET is_enabled=false WHERE id='00000000-0000-4000-8000-000000000302';
-- Fixture-only restrictive policies prove that count AND page use caller RLS,
-- rather than definer visibility. Existing production policy bytes are untouched.
CREATE POLICY catalogue_read_product_fixture ON public.products AS RESTRICTIVE FOR SELECT TO authenticated USING (
 auth.uid()='00000000-0000-4000-8000-000000000101'::uuid AND id IN
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000203'));
CREATE POLICY catalogue_read_customer_fixture ON public.customers AS RESTRICTIVE FOR SELECT TO authenticated USING (
 auth.uid()='00000000-0000-4000-8000-000000000101'::uuid AND id IN
 ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000302'));
SELECT pg_temp.catalogue_read_assert((SELECT NOT p.prosecdef AND p.provolatile='s' AND array_position(p.proconfig,'search_path=""') IS NOT NULL
 FROM pg_proc p WHERE p.oid='public.pilot_catalog_page_v1(text,text,text,text,integer,integer)'::regprocedure),'stable invoker with empty search path');
SELECT pg_temp.catalogue_read_assert(NOT has_function_privilege('anon','public.pilot_catalog_page_v1(text,text,text,text,integer,integer)','EXECUTE'),'anon execute denied');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
DO $$ DECLARE all_rows jsonb; enabled jsonb; disabled jsonb; page2 jsonb; keys text[]; BEGIN
 PERFORM pg_temp.catalogue_read_assert(current_user='authenticated' AND row_security_active('public.products') AND row_security_active('public.customers'), 'actual RLS application role');
 all_rows := public.pilot_catalog_page_v1('product','all-for-history','all','',1,2);
 enabled := public.pilot_catalog_page_v1('product','enabled-for-order','enabled','',1,250);
 disabled := public.pilot_catalog_page_v1('product','catalogue','disabled','',1,250);
 page2 := public.pilot_catalog_page_v1('product','all-for-history','all','',2,2);
 PERFORM pg_temp.catalogue_read_assert(all_rows->>'total_count'='3' AND jsonb_typeof(all_rows->'total_count')='string' AND jsonb_array_length(all_rows->'rows')=2,'exact RLS count and first page');
 PERFORM pg_temp.catalogue_read_assert(all_rows->'rows'->0->>'catalog_version'='9007199254740993' AND jsonb_typeof(all_rows->'rows'->0->'catalog_version')='string','large version is decimal text');
 PERFORM pg_temp.catalogue_read_assert(all_rows->'rows'->0->>'id' < all_rows->'rows'->1->>'id' AND page2->'rows'->0->>'id' > all_rows->'rows'->1->>'id','stable id ordering across pages');
 PERFORM pg_temp.catalogue_read_assert(enabled->>'total_count'='2' AND disabled->>'total_count'='1' AND page2->'rows'->0->'is_enabled'='false'::jsonb,'disabled history remains visible and excluded from demand');
 SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(all_rows->'rows'->0) k;
 PERFORM pg_temp.catalogue_read_assert(keys=ARRAY['catalog_version','dalam_kota','depo_bangunan','harga_pokok','id','is_enabled','luar_kota','name','size','sku','unit_price'],'explicit product projection');
 PERFORM pg_temp.catalogue_read_assert(public.pilot_catalog_page_v1('product','catalogue','all','100%_',1,250)->>'total_count'='1','literal percent and underscore');
 PERFORM pg_temp.catalogue_read_assert(public.pilot_catalog_page_v1('product','all-for-history','all','',2147483647,250)->'rows'='[]'::jsonb,'large offset uses bigint');
 PERFORM pg_temp.catalogue_read_assert(public.pilot_catalog_page_v1('customer','all-for-history','all','',1,250)->>'total_count'='2','customer projection uses same RLS contract');
 PERFORM pg_temp.catalogue_read_raises($q$SELECT public.pilot_catalog_page_v1('product','enabled-for-order','all','',1,250)$q$,'22023','order cannot request disabled/all');
 PERFORM pg_temp.catalogue_read_raises($q$SELECT public.pilot_catalog_page_v1('product','all-for-history','enabled','',1,250)$q$,'22023','history must include enabled and disabled');
 PERFORM pg_temp.catalogue_read_raises($q$SELECT public.pilot_catalog_page_v1(NULL,'catalogue','all','',1,250)$q$,'22023','null kind');
 PERFORM pg_temp.catalogue_read_raises($q$SELECT public.pilot_catalog_page_v1('product','catalogue','all',NULL,1,250)$q$,'22023','null search');
 PERFORM pg_temp.catalogue_read_raises($q$SELECT public.pilot_catalog_page_v1('product','catalogue','all','',0,250)$q$,'22023','page zero');
 PERFORM pg_temp.catalogue_read_raises($q$SELECT public.pilot_catalog_page_v1('product','catalogue','all','',1,251)$q$,'22023','oversized page');
END $$;
-- Runtime coordinator extracts this exact one-line marker to
-- tests/catalogue/fixtures/catalogue-read-sql-output.json, then runs the TS test.
SELECT 'CATALOGUE_READ_SQL_OUTPUT:' || jsonb_build_object('format','catalogue-read-sql-output-v1',
 'identity',jsonb_build_object('backend','https://catalogue.example.invalid','actorId',auth.uid(),'role',public.current_user_role()),
 'pages',jsonb_build_array(
   public.pilot_catalog_page_v1('product','all-for-history','all','',1,2),
   public.pilot_catalog_page_v1('product','all-for-history','all','',2,2),
   public.pilot_catalog_page_v1('product','enabled-for-order','enabled','',1,250),
   public.pilot_catalog_page_v1('customer','all-for-history','all','',1,250)),
 'access',public.pilot_procurement_access_v2())::text;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true);
SELECT pg_temp.catalogue_read_assert(public.pilot_catalog_page_v1('product','all-for-history','all','',1,250)->>'total_count'='0'
 AND public.pilot_catalog_page_v1('product','all-for-history','all','',1,250)->'rows'='[]'::jsonb,'other active caller sees exact zero, not privileged count');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.catalogue_read_raises($q$SELECT public.pilot_catalog_page_v1('product','catalogue','all','',1,250)$q$,'42501','missing actor refused');
RESET ROLE;
UPDATE public.users SET is_active=false WHERE id='00000000-0000-4000-8000-000000000101';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
SELECT pg_temp.catalogue_read_raises($q$SELECT public.pilot_catalog_page_v1('product','catalogue','all','',1,250)$q$,'42501','inactive actor refused');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
