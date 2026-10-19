-- AUTHORED, UNRUN. Fictional rollback harness only. Requires fixture+migrations,
-- before-foundation.sql+01-foundation.sql in the same transaction. Not production.
SELECT set_config('request.jwt.claim.sub','',true);
CREATE TEMP TABLE target_acl_before AS SELECT oid, relacl, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='public.customer_targets'::regclass;
CREATE TEMP TABLE target_policies_before AS SELECT oid,to_jsonb(p) AS definition FROM pg_policy p WHERE polrelid='public.customer_targets'::regclass;
INSERT INTO public.customers(id,name) SELECT md5('target-fiction-'||n)::uuid,'Fictional target customer '||n FROM generate_series(1,6) n;
-- A historical target begins unknown until an actual event; no retroactive unused.
INSERT INTO public.customer_targets(id,customer_id,year_month,set_by) VALUES(md5('target-existing')::uuid,md5('target-fiction-1')::uuid,'2099-01',md5('catalogue-foundation-actor-3')::uuid);
\ir ../../../supabase/catalogue/v1/02-customer-target-tracking.sql
SELECT pg_temp.foundation_assert((SELECT c.relacl IS NOT DISTINCT FROM b.relacl AND c.relrowsecurity=b.relrowsecurity AND c.relforcerowsecurity=b.relforcerowsecurity FROM pg_class c JOIN target_acl_before b USING(oid)),'target table ACL and RLS unchanged');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM target_policies_before b FULL JOIN (SELECT oid,to_jsonb(p) definition FROM pg_policy p WHERE polrelid='public.customer_targets'::regclass) a USING(oid) WHERE a.definition IS DISTINCT FROM b.definition),'target policy definitions unchanged');
UPDATE public.customer_targets SET target_value=target_value WHERE id=md5('target-existing')::uuid;
SELECT pg_temp.foundation_assert((SELECT lifetime_state='used' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('target-fiction-1')::uuid),'unchanged actual UPDATE marks historical target');
-- Discarded attempted customer 2 must not become used; conflict is on supplied id.
INSERT INTO public.customer_targets(id,customer_id,year_month,set_by) VALUES(md5('target-existing')::uuid,md5('target-fiction-2')::uuid,'2099-02',md5('catalogue-foundation-actor-3')::uuid) ON CONFLICT(id) DO NOTHING;
SELECT pg_temp.foundation_assert((SELECT lifetime_state='unknown' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('target-fiction-2')::uuid),'discarded insert never marks attempted identity');
-- Authorized owner, auth.uid NULL: fixture permits privileged rebinding. Both
-- actual OLD and NEW survive; no application actor guard is weakened.
INSERT INTO public.customer_targets(id,customer_id,year_month,set_by) VALUES(md5('target-existing')::uuid,md5('target-fiction-2')::uuid,'2099-02',md5('catalogue-foundation-actor-3')::uuid) ON CONFLICT(id) DO UPDATE SET customer_id=excluded.customer_id;
DELETE FROM public.customer_targets WHERE id=md5('target-existing')::uuid;
SELECT pg_temp.foundation_assert((SELECT count(*)=2 FROM private.catalog_identity_v1 WHERE kind='customer' AND id IN(md5('target-fiction-1')::uuid,md5('target-fiction-2')::uuid) AND lifetime_state='used'),'OLD and NEW retained after removal');
SAVEPOINT target_rollback;
INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES(md5('target-fiction-3')::uuid,'2099-01',md5('catalogue-foundation-actor-3')::uuid);
ROLLBACK TO SAVEPOINT target_rollback;
SELECT pg_temp.foundation_assert((SELECT lifetime_state='unknown' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('target-fiction-3')::uuid),'savepoint rolls evidence back with target');
-- Fictional CASCADE variant only; not an assertion about any remote substrate.
SET CONSTRAINTS public.catalog_customer_targets_assert_v1 IMMEDIATE;
ALTER TABLE public.customer_targets DROP CONSTRAINT customer_targets_customer_id_fkey;
ALTER TABLE public.customer_targets ADD CONSTRAINT customer_targets_customer_id_fkey FOREIGN KEY(customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
SET CONSTRAINTS public.catalog_customer_targets_assert_v1 DEFERRED;
INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES(md5('target-fiction-4')::uuid,'2099-01',md5('catalogue-foundation-actor-3')::uuid);
DELETE FROM public.customers WHERE id=md5('target-fiction-4')::uuid;
SET CONSTRAINTS public.catalog_customer_targets_assert_v1 IMMEDIATE;
SELECT pg_temp.foundation_assert((SELECT lifetime_state='used' AND deleted_at IS NOT NULL FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('target-fiction-4')::uuid),'cascade OLD and parent tombstone retained');
SET CONSTRAINTS public.catalog_customer_targets_assert_v1 DEFERRED;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('catalogue-foundation-actor-3')::uuid::text,true);
INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES(md5('target-fiction-5')::uuid,'2099-01',auth.uid());
SELECT pg_temp.foundation_raises($q$UPDATE public.customer_targets SET customer_id=md5('target-fiction-6')::uuid WHERE customer_id=md5('target-fiction-5')::uuid$q$,'42501','authenticated scope stays immutable');
SELECT pg_temp.foundation_raises($q$UPDATE public.customer_targets SET set_by=md5('catalogue-foundation-actor-6')::uuid WHERE customer_id=md5('target-fiction-5')::uuid$q$,'42501','set_by remains actor');
DELETE FROM public.customer_targets WHERE customer_id=md5('target-fiction-5')::uuid;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET CONSTRAINTS public.catalog_customer_targets_assert_v1 IMMEDIATE;
SELECT pg_temp.foundation_assert((SELECT lifetime_state='used' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('target-fiction-5')::uuid),'actual authenticated insert/delete retains use');
SELECT pg_temp.foundation_assert((SELECT NOT tracking_ready AND execution_generation=1 FROM private.catalog_cutover_v1),'readiness stays false');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 WHERE lifetime_state='unused'),'no new unused allocation');
-- Fictional fault injection, isolated by savepoint. No actual identity is repaired.
SAVEPOINT missing_target_identity;
ALTER TABLE public.customers DISABLE TRIGGER catalog_master_after_v1;
INSERT INTO public.customers(id,name) VALUES(md5('target-missing-identity')::uuid,'Fictional missing identity');
ALTER TABLE public.customers ENABLE TRIGGER catalog_master_after_v1;
SET CONSTRAINTS public.catalog_customer_targets_assert_v1 DEFERRED;
SELECT pg_temp.foundation_raises($q$INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES(md5('target-missing-identity')::uuid,'2099-01',md5('catalogue-foundation-actor-3')::uuid)$q$,'23514','missing identity fails closed');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('target-missing-identity')::uuid),'missing identity not repaired');
ROLLBACK TO SAVEPOINT missing_target_identity;
SAVEPOINT assertion_only;
ALTER TABLE public.customer_targets DISABLE TRIGGER catalog_customer_targets_mark_v1;
SET CONSTRAINTS public.catalog_customer_targets_assert_v1 IMMEDIATE;
SELECT pg_temp.foundation_raises($q$INSERT INTO public.customer_targets(customer_id,year_month,set_by) VALUES(md5('target-fiction-6')::uuid,'2099-01',md5('catalogue-foundation-actor-3')::uuid)$q$,'23514','assertion cannot repair unmarked target');
SELECT pg_temp.foundation_assert((SELECT lifetime_state='unknown' FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('target-fiction-6')::uuid),'assertion leaves evidence unchanged');
ROLLBACK TO SAVEPOINT assertion_only;
-- Caller must ROLLBACK the entire fictional harness, including CASCADE variant.
