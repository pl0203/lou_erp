-- AUTHORED / UNRUN. Fictional NULL/SET NULL substrate only, outer rollback required.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SET CONSTRAINTS public.catalog_customer_targets_assert_v1 DEFERRED;
ALTER TABLE public.customer_targets ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.customer_targets DROP CONSTRAINT customer_targets_customer_id_fkey;
ALTER TABLE public.customer_targets ADD CONSTRAINT customer_targets_customer_id_fkey FOREIGN KEY(customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
INSERT INTO public.customers(id,name) VALUES
(md5('target-null-image')::uuid,'Fictional null image customer'),
(md5('target-set-null')::uuid,'Fictional SET NULL customer');
CREATE TEMP TABLE target_null_versions AS SELECT id,last_version FROM private.catalog_identity_v1 WHERE kind='customer' AND id IN(md5('target-null-image')::uuid,md5('target-set-null')::uuid);
CREATE TEMP TABLE target_null_count AS SELECT count(*) n FROM private.catalog_identity_v1;
INSERT INTO public.customer_targets(id,customer_id,year_month,set_by) VALUES(md5('target-null-row')::uuid,NULL,'2097-01',md5('catalogue-foundation-actor-3')::uuid);
UPDATE public.customer_targets SET customer_id=NULL WHERE id=md5('target-null-row')::uuid;
SELECT pg_temp.foundation_assert((SELECT count(*)=(SELECT n FROM target_null_count) FROM private.catalog_identity_v1),'null images create no identity');
UPDATE public.customer_targets SET customer_id=md5('target-null-image')::uuid WHERE id=md5('target-null-row')::uuid;
UPDATE public.customer_targets SET customer_id=NULL WHERE id=md5('target-null-row')::uuid;
DELETE FROM public.customer_targets WHERE id=md5('target-null-row')::uuid;
SET CONSTRAINTS public.catalog_customer_targets_assert_v1 IMMEDIATE;
SELECT pg_temp.foundation_assert((SELECT lifetime_state='used' AND deleted_at IS NULL FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('target-null-image')::uuid),'null transition retains actual nonnull image');
SELECT pg_temp.foundation_assert((SELECT e.last_version=v.last_version FROM private.catalog_identity_v1 e JOIN target_null_versions v USING(id) WHERE e.kind='customer' AND e.id=md5('target-null-image')::uuid),'version retained by target events');
SET CONSTRAINTS public.catalog_customer_targets_assert_v1 DEFERRED;
INSERT INTO public.customer_targets(id,customer_id,year_month,set_by) VALUES(md5('target-set-null-row')::uuid,md5('target-set-null')::uuid,'2097-02',md5('catalogue-foundation-actor-3')::uuid);
DELETE FROM public.customers WHERE id=md5('target-set-null')::uuid;
SET CONSTRAINTS public.catalog_customer_targets_assert_v1 IMMEDIATE;
SELECT pg_temp.foundation_assert((SELECT customer_id IS NULL FROM public.customer_targets WHERE id=md5('target-set-null-row')::uuid),'SET NULL preserves target as null');
SELECT pg_temp.foundation_assert((SELECT lifetime_state='used' AND deleted_at IS NOT NULL FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('target-set-null')::uuid),'SET NULL retains used tombstone');
CREATE TEMP TABLE target_retained_tombstone AS SELECT * FROM private.catalog_identity_v1 WHERE kind='customer' AND id=md5('target-set-null')::uuid;
DELETE FROM public.customer_targets WHERE id=md5('target-set-null-row')::uuid;
SELECT pg_temp.foundation_assert((SELECT to_jsonb(e)=to_jsonb(t) FROM private.catalog_identity_v1 e JOIN target_retained_tombstone t USING(kind,id)),'null deletion preserves entire tombstone');
SELECT pg_temp.foundation_assert((SELECT NOT tracking_ready AND execution_generation=1 FROM private.catalog_cutover_v1),'NULL variants do not activate cutover');
