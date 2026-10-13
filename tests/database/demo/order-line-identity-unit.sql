-- Bounded defensive helper/unit checks only. One synthetic owner; no cross-actor scenario.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL TIME ZONE 'UTC';
INSERT INTO auth.users VALUES('fb000000-0000-0000-0000-000000000001');
INSERT INTO public.users(id,full_name,email,role) VALUES('fb000000-0000-0000-0000-000000000001','Identity unit admin','identity-unit@synthetic.invalid','po_admin');
INSERT INTO public.customers(id,name) VALUES('fb100000-0000-0000-0000-000000000001','Identity unit store');
SELECT set_config('request.jwt.claim.sub','fb000000-0000-0000-0000-000000000001',true);
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status) VALUES('fb200000-0000-0000-0000-000000000001','fb100000-0000-0000-0000-000000000001','fb000000-0000-0000-0000-000000000001','IDENTITY-UNIT','confirm');
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price) VALUES('fb300000-0000-0000-0000-000000000001','fb200000-0000-0000-0000-000000000001','Historical unchanged line','UNIT',3,17);
CREATE FUNCTION pg_temp.identity_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',message; END IF; END $$;
DO $$ DECLARE candidate uuid:='fb300000-0000-0000-0000-000000000002'; BEGIN
 PERFORM pg_temp.identity_assert(private.demo_require_new_line_identity(candidate,'{}')=candidate,'unused identity is accepted by the private guard');
 BEGIN PERFORM private.demo_require_new_line_identity('fb300000-0000-0000-0000-000000000001','{}'); RAISE EXCEPTION 'ASSERT persisted identity accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN PERFORM private.demo_require_new_line_identity(candidate,ARRAY[candidate]); RAISE EXCEPTION 'ASSERT reserved identity accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN PERFORM private.demo_require_new_line_identity(NULL,'{}'); RAISE EXCEPTION 'ASSERT null identity accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM pg_temp.identity_assert((SELECT count(*)=1 FROM public.po_line_items WHERE purchase_order_id='fb200000-0000-0000-0000-000000000001'),'identity guard has no row mutation');
END $$;
-- An unchanged delivered line remains a valid existing identity and keeps all stored snapshots.
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by) VALUES('fb400000-0000-0000-0000-000000000001','fb200000-0000-0000-0000-000000000001','IDENTITY-UNIT-SJ',current_date,'fb000000-0000-0000-0000-000000000001');
INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered) VALUES('fb400000-0000-0000-0000-000000000001','fb300000-0000-0000-0000-000000000001',1);
SET CONSTRAINTS ALL IMMEDIATE;
SET LOCAL ROLE authenticated;
DO $$ DECLARE original jsonb; r jsonb; BEGIN
 SELECT to_jsonb(l) INTO original FROM public.po_line_items l WHERE id='fb300000-0000-0000-0000-000000000001';
 r:=public.pilot_order_transaction(gen_random_uuid(),'edit_po',jsonb_build_object('po_id','fb200000-0000-0000-0000-000000000001','customer_id','fb100000-0000-0000-0000-000000000001','expected_updated_at',(SELECT updated_at FROM public.purchase_orders WHERE id='fb200000-0000-0000-0000-000000000001'),'notes','Permitted notes edit','items',jsonb_build_array(original||'{"unit_price":17}')));
 PERFORM pg_temp.identity_assert(r->>'id'='fb200000-0000-0000-0000-000000000001','normal existing-line edit succeeds');
 PERFORM pg_temp.identity_assert((SELECT to_jsonb(l)=original FROM public.po_line_items l WHERE id='fb300000-0000-0000-0000-000000000001'),'unchanged delivered fields remain byte-for-byte equal');
END $$;
RESET ROLE;
SELECT pg_temp.identity_assert(NOT has_function_privilege('authenticated','private.demo_require_new_line_identity(uuid,uuid[])','EXECUTE'),'new identity guard is private');
SELECT 'DEMO_LINE_IDENTITY_UNIT_PASSED' AS result;
ROLLBACK;
