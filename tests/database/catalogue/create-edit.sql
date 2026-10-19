-- Exact synthetic current-policy tests. No hosted data, parity, or rollout claim.
-- Applied after new08 in the existing identity-bound rollback-only harness.
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id) SELECT md5('catalogue-write-actor-'||n)::uuid FROM generate_series(1,5)n;
INSERT INTO public.users(id,full_name,email,role,is_active)
SELECT md5('catalogue-write-actor-'||n)::uuid,'Fictional catalogue writer','catalogue-write-'||n||'@example.invalid',
  (ARRAY['co_admin','po_admin','executive','sales_person','co_admin'])[n]::public.user_role,n<>5 FROM generate_series(1,5)n;
CREATE TEMP TABLE catalogue_write_receipts_v1(actor integer,kind text,create_payload jsonb,create_receipt jsonb,edit_receipt jsonb) ON COMMIT DROP;
GRANT SELECT,INSERT,UPDATE ON pg_temp.catalogue_write_receipts_v1 TO authenticated;

SET LOCAL ROLE authenticated;
DO $forms$
DECLARE n integer; kind text; payload jsonb; created jsonb; edited jsonb; no_op jsonb; changed jsonb; request uuid; key uuid;
BEGIN
  FOR n IN 1..3 LOOP
    PERFORM set_config('request.jwt.claim.sub',md5('catalogue-write-actor-'||n)::uuid::text,true);
    FOREACH kind IN ARRAY ARRAY['customer','product'] LOOP
      payload := jsonb_build_object('kind',kind,'values',CASE kind WHEN 'customer' THEN jsonb_build_object(
        'name','Fictional customer '||n,'address',NULL,'city','Fictional city','phone',NULL,'email',NULL,'pricing_tier','luar_kota','customer_category','perorangan')
        ELSE jsonb_build_object('name','Fictional product '||n,'sku','CATALOGUE-WRITE-'||n,'size',NULL,
          'harga_pokok',NULL,'luar_kota',0,'dalam_kota',12.34,'depo_bangunan',999999999999.99) END);
      request := md5('catalogue-write-create-'||n||kind)::uuid;
      created := public.pilot_catalog_transaction_v1(request,'create',payload);
      key := (created->>'id')::uuid;
      PERFORM pg_temp.foundation_assert(created @> jsonb_build_object('version',1,'request_id',request,'actor_id',auth.uid(),
        'operation','create','kind',kind,'before',NULL,'after',jsonb_build_object('catalog_version','1','is_enabled',true)),'create receipt exact actor and string version');
      PERFORM pg_temp.foundation_assert(public.pilot_catalog_transaction_v1(request,'create',payload)=created,'exact create replay is stable');
      PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(request,false)=jsonb_build_object('status','committed','receipt',created),'create reconcile receipt');
      changed := jsonb_build_object('kind',kind,'id',key,'expected_version','1','values',jsonb_build_object('name','Fictional renamed '||n));
      edited := public.pilot_catalog_transaction_v1(md5('catalogue-write-edit-'||n||kind)::uuid,'edit',changed);
      PERFORM pg_temp.foundation_assert(edited->'before'=created->'after' AND edited->'after'='{"catalog_version":"2","is_enabled":true}'::jsonb,'edit increments once');
      no_op := public.pilot_catalog_transaction_v1(md5('catalogue-write-no-op-'||n||kind)::uuid,'edit',jsonb_set(changed,'{expected_version}','"2"'));
      PERFORM pg_temp.foundation_assert(no_op->'before'=no_op->'after','no-op edit does not increase version');
      PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''edit'',%L::jsonb)',md5('catalogue-write-stale-'||n||kind),changed),'40001','stale version refused');
      PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''create'',%L::jsonb)',request,jsonb_set(payload,'{values,name}','"Different request"')),'22023','same request different payload refused');
      PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''edit'',%L::jsonb)',request,changed),'22023','same request different operation refused');
      INSERT INTO pg_temp.catalogue_write_receipts_v1 VALUES(n,kind,payload,created,edited);
    END LOOP;
  END LOOP;
END $forms$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.foundation_assert((SELECT count(*)=6 FROM pg_temp.catalogue_write_receipts_v1),'all maintainer/kind forms covered');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM public.products p JOIN pg_temp.catalogue_write_receipts_v1 r ON p.id=(r.create_receipt->>'id')::uuid WHERE r.kind='product' AND p.unit_price IS NOT NULL),'new legacy product price is NULL');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE status='pending'),'no pending state remains');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_identity_v1 WHERE lifetime_state='unused'),'create/edit does not certify unused provenance');

-- Existing legacy values remain intact and decimal bigint never rounds.
UPDATE public.products SET unit_price=42 WHERE id=(SELECT (create_receipt->>'id')::uuid FROM pg_temp.catalogue_write_receipts_v1 WHERE actor=1 AND kind='product');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('catalogue-write-actor-1')::uuid::text,true);
DO $$ DECLARE key uuid; receipt jsonb; BEGIN
  SELECT (create_receipt->>'id')::uuid INTO key FROM pg_temp.catalogue_write_receipts_v1 WHERE actor=1 AND kind='product';
  receipt := public.pilot_catalog_transaction_v1(md5('catalogue-write-retain-legacy')::uuid,'edit',jsonb_build_object('kind','product','id',key,'expected_version','3','values',jsonb_build_object('sku','CATALOGUE-WRITE-CHANGED')));
  PERFORM pg_temp.foundation_assert((SELECT unit_price=42 FROM public.products WHERE id=key),'edit preserves legacy unit_price');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''edit'',%L::jsonb)',md5('catalogue-write-extra'),jsonb_build_object('kind','product','id',key,'expected_version','4','values',jsonb_build_object('unit_price',0))),'22023','legacy price is not a form field');
  PERFORM pg_temp.foundation_raises($q$SELECT public.pilot_catalog_transaction_v1(md5('catalogue-write-missing')::uuid,'edit',jsonb_build_object('kind','product','id',md5('catalogue-missing-row')::uuid,'expected_version','1','values',jsonb_build_object('name','No target')))$q$,'P0002','missing target cannot prove success');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);

-- Revoke every actually required write/read grant, including inherited paths.
-- Original broader legacy columns are not prerequisites for partial form edits.
DO $grants$
<<grants>>
DECLARE kind text; relation text; column_name text; privilege text; row record; payload jsonb; ordinal integer:=0;
BEGIN
  FOREACH kind IN ARRAY ARRAY['customer','product'] LOOP
    relation := 'public.'||CASE kind WHEN 'customer' THEN 'customers' ELSE 'products' END;
    SELECT * INTO row FROM pg_temp.catalogue_write_receipts_v1 r WHERE r.actor=2 AND r.kind=grants.kind;
    FOREACH privilege IN ARRAY ARRAY['INSERT','UPDATE'] LOOP
      FOR column_name IN SELECT key FROM jsonb_object_keys(row.create_payload->'values') key LOOP
        ordinal:=ordinal+1;
        EXECUTE format('REVOKE %s (%I) ON %s FROM authenticated',privilege,column_name,relation);
        IF kind='product' AND privilege='UPDATE' THEN EXECUTE format('REVOKE UPDATE (%I) ON public.products FROM catalogue_foundation_inherited_probe',column_name); END IF;
        PERFORM set_config('request.jwt.claim.sub',md5('catalogue-write-actor-2')::uuid::text,true);
        EXECUTE 'SET LOCAL ROLE authenticated';
        payload := CASE privilege WHEN 'INSERT' THEN row.create_payload ELSE jsonb_build_object('kind',kind,'id',row.create_receipt->'id','expected_version','2','values',jsonb_build_object(column_name,row.create_payload->'values'->column_name)) END;
        PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,%L,%L::jsonb)',md5('catalogue-grant-'||ordinal),CASE privilege WHEN 'INSERT' THEN 'create' ELSE 'edit' END,payload),'42501','revoked required column denies direct RPC');
        EXECUTE 'RESET ROLE';
        PERFORM set_config('request.jwt.claim.sub','',true);
        EXECUTE format('GRANT %s (%I) ON %s TO authenticated',privilege,column_name,relation);
        IF kind='product' AND privilege='UPDATE' THEN EXECUTE format('GRANT UPDATE (%I) ON public.products TO catalogue_foundation_inherited_probe',column_name); END IF;
        PERFORM pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE request_id=md5('catalogue-grant-'||ordinal)::uuid),'denied grant leaves no ledger row');
      END LOOP;
    END LOOP;
  END LOOP;
END $grants$;

-- Additional generated-field INSERT and exact SELECT/recovery grant checks.
DO $more_grants$
DECLARE field text; relation text; columns text; row record; request uuid;
BEGIN
  SELECT * INTO row FROM pg_temp.catalogue_write_receipts_v1 WHERE actor=2 AND kind='product';
  FOREACH field IN ARRAY ARRAY['id','unit_price'] LOOP
    request:=md5('catalogue-insert-extra-'||field)::uuid;
    BEGIN
      EXECUTE format('REVOKE INSERT (%I) ON public.products FROM authenticated',field);
      PERFORM set_config('request.jwt.claim.sub',md5('catalogue-write-actor-2')::uuid::text,true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''create'',%L::jsonb)',request,row.create_payload),'42501','required generated/legacy insert column revoked');
      EXECUTE 'RESET ROLE';
      PERFORM pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE request_id=request),'insert refusal leaves no receipt');
      RAISE EXCEPTION 'Rollback temporary grant probe' USING ERRCODE='PC801';
    EXCEPTION WHEN SQLSTATE 'PC801' THEN NULL;
    END;
  END LOOP;
  FOREACH relation IN ARRAY ARRAY['public.customers','public.products'] LOOP
    SELECT * INTO row FROM pg_temp.catalogue_write_receipts_v1 WHERE actor=2 AND kind=CASE relation WHEN 'public.customers' THEN 'customer' ELSE 'product' END;
    FOREACH field IN ARRAY ARRAY['id','catalog_version','is_enabled'] LOOP
      request:=md5('catalogue-select-'||relation||field)::uuid;
      BEGIN
        EXECUTE format('REVOKE SELECT ON %s FROM authenticated',relation);
        SELECT string_agg(quote_ident(attname),', ' ORDER BY attnum) INTO columns FROM pg_catalog.pg_attribute
          WHERE attrelid=relation::regclass AND attnum>0 AND NOT attisdropped AND attname<>field;
        EXECUTE format('GRANT SELECT (%s) ON %s TO authenticated',columns,relation);
        PERFORM set_config('request.jwt.claim.sub',md5('catalogue-write-actor-2')::uuid::text,true);
        EXECUTE 'SET LOCAL ROLE authenticated';
        PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''edit'',%L::jsonb)',request,
          jsonb_build_object('kind',row.kind,'id',row.create_receipt->'id','expected_version','2','values',jsonb_build_object('name','Denied read'))),'42501','required SELECT column revoked');
        PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_reconcile_catalog_v1(%L::uuid,false)',row.edit_receipt->>'request_id'),'42501','recovery rechecks required SELECT');
        EXECUTE 'RESET ROLE';
        PERFORM pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE request_id=request),'select refusal leaves no receipt');
        RAISE EXCEPTION 'Rollback temporary grant probe' USING ERRCODE='PC801';
      EXCEPTION WHEN SQLSTATE 'PC801' THEN NULL;
      END;
    END LOOP;
  END LOOP;
  SELECT * INTO row FROM pg_temp.catalogue_write_receipts_v1 WHERE actor=2 AND kind='product';
  BEGIN
    REVOKE UPDATE (name) ON public.products FROM authenticated,catalogue_foundation_inherited_probe;
    PERFORM set_config('request.jwt.claim.sub',md5('catalogue-write-actor-2')::uuid::text,true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_reconcile_catalog_v1(%L::uuid,false)',row.edit_receipt->>'request_id'),'42501','recovery rechecks saved actual UPDATE grant');
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'Rollback temporary grant probe' USING ERRCODE='PC801';
  EXCEPTION WHEN SQLSTATE 'PC801' THEN NULL;
  END;
END $more_grants$;
SELECT set_config('request.jwt.claim.sub','',true);

-- Fail after master/evidence mutation to prove pending admission and receipt roll
-- back atomically; a skipped/zero-row trigger cannot produce a success receipt.
CREATE FUNCTION pg_temp.catalog_write_fail_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name='Fictional force rollback' THEN RAISE EXCEPTION 'Injected rollback' USING ERRCODE='PC802'; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION pg_temp.catalog_write_skip_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name='Fictional force zero' THEN RETURN NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zzz_catalogue_write_fail AFTER INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION pg_temp.catalog_write_fail_v1();
CREATE TRIGGER zzz_catalogue_write_skip BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION pg_temp.catalog_write_skip_v1();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('catalogue-write-actor-2')::uuid::text,true);
DO $$ DECLARE row record; BEGIN
 SELECT * INTO row FROM pg_temp.catalogue_write_receipts_v1 WHERE actor=2 AND kind='product';
 PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''create'',%L::jsonb)',md5('catalogue-write-rollback-create'),
   jsonb_set(jsonb_set(row.create_payload,'{values,name}','"Fictional force rollback"'),'{values,sku}','"CATALOGUE-ROLLBACK-CREATE"')),'PC802','failed create rolls back after evidence');
 PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''edit'',%L::jsonb)',md5('catalogue-write-rollback-edit'),
   jsonb_build_object('kind','product','id',row.create_receipt->'id','expected_version','2','values',jsonb_build_object('name','Fictional force rollback'))),'PC802','failed edit rolls back after evidence');
 PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''edit'',%L::jsonb)',md5('catalogue-write-zero-edit'),
   jsonb_build_object('kind','product','id',row.create_receipt->'id','expected_version','2','values',jsonb_build_object('name','Fictional force zero'))),'23514','zero-row edit cannot commit receipt');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
DROP TRIGGER zzz_catalogue_write_fail ON public.products;
DROP TRIGGER zzz_catalogue_write_skip ON public.products;
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE request_id IN (
 md5('catalogue-write-rollback-create')::uuid,md5('catalogue-write-rollback-edit')::uuid,md5('catalogue-write-zero-edit')::uuid)),'rollback and zero-row leave no pending/committed receipt');
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM public.products WHERE sku='CATALOGUE-ROLLBACK-CREATE'),'failed create master absent');
SELECT pg_temp.foundation_assert((SELECT p.name='Fictional renamed 2' AND p.catalog_version=2 AND i.last_version=2
 FROM public.products p JOIN private.catalog_identity_v1 i ON i.kind='product' AND i.id=p.id
 WHERE p.id=(SELECT (create_receipt->>'id')::uuid FROM pg_temp.catalogue_write_receipts_v1 WHERE actor=2 AND kind='product')),'failed edit retains master/evidence state');

-- An added restrictive old/proposed-row policy makes direct baseline DML deny the
-- row; definer RPC must fail closed, never silently bypass that current predicate.
CREATE POLICY catalogue_write_deny_probe ON public.customers AS RESTRICTIVE FOR UPDATE TO authenticated USING(name<>'Fictional renamed 2') WITH CHECK(city<>'Forbidden city');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('catalogue-write-actor-2')::uuid::text,true);
DO $$ DECLARE key uuid; affected integer; BEGIN
  SELECT (create_receipt->>'id')::uuid INTO key FROM pg_temp.catalogue_write_receipts_v1 WHERE actor=2 AND kind='customer';
  UPDATE public.customers SET name='Denied baseline' WHERE id=key;
  GET DIAGNOSTICS affected=ROW_COUNT;
  PERFORM pg_temp.foundation_assert(affected=0,'current USING baseline denies old row');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''edit'',%L::jsonb)',md5('catalogue-write-policy-old'),jsonb_build_object('kind','customer','id',key,'expected_version','2','values',jsonb_build_object('name','Denied RPC'))),'42501','RPC refuses unproved CURRENT old-row predicate');
  SELECT (create_receipt->>'id')::uuid INTO key FROM pg_temp.catalogue_write_receipts_v1 WHERE actor=3 AND kind='customer';
  PERFORM pg_temp.foundation_raises(format('UPDATE public.customers SET city=''Forbidden city'' WHERE id=%L::uuid',key),'42501','current WITH CHECK baseline denies proposed row');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''edit'',%L::jsonb)',md5('catalogue-write-policy-new'),jsonb_build_object('kind','customer','id',key,'expected_version','2','values',jsonb_build_object('city','Forbidden city'))),'42501','RPC refuses unproved CURRENT proposed predicate');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
DROP POLICY catalogue_write_deny_probe ON public.customers;

-- Receipt replay/recovery after target deletion and current-authority changes.
DELETE FROM public.products WHERE id=(SELECT (create_receipt->>'id')::uuid FROM pg_temp.catalogue_write_receipts_v1 WHERE actor=3 AND kind='product');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('catalogue-write-actor-3')::uuid::text,true);
DO $$ DECLARE row record; BEGIN
  SELECT * INTO row FROM pg_temp.catalogue_write_receipts_v1 WHERE actor=3 AND kind='product';
  PERFORM pg_temp.foundation_assert(public.pilot_catalog_transaction_v1((row.create_receipt->>'request_id')::uuid,'create',row.create_payload)=row.create_receipt,'create replay after deletion stable');
  PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1((row.edit_receipt->>'request_id')::uuid,false)=jsonb_build_object('status','committed','receipt',row.edit_receipt),'edit recovery after deletion stable');
  PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(md5('catalogue-write-unbound')::uuid,true)='{"status":"abandoned"}'::jsonb,'unknown explicit abandon');
  PERFORM pg_temp.foundation_assert(public.pilot_reconcile_catalog_v1(md5('catalogue-write-unbound')::uuid,false)='{"status":"abandoned"}'::jsonb,'unbound abandoned reconcile');
  PERFORM pg_temp.foundation_raises(format('SELECT public.pilot_catalog_transaction_v1(%L::uuid,''create'',%L::jsonb)',md5('catalogue-write-unbound'),row.create_payload),'22023','late dispatch cannot pass tombstone');
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE public.users SET role='sales_person' WHERE id=md5('catalogue-write-actor-3')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',md5('catalogue-write-actor-3')::uuid::text,true);
SELECT pg_temp.foundation_raises($q$SELECT public.pilot_reconcile_catalog_v1(md5('catalogue-write-create-3product')::uuid,false)$q$,'42501','lost current role cannot recover old write');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);

-- Pending evidence cannot leak through a forced-immediate or commit-time check.
SELECT pg_temp.foundation_raises($q$UPDATE private.catalog_requests_v1 SET receipt='{}' WHERE status='committed'$q$,'23514','terminal receipts immutable');
SELECT pg_temp.foundation_raises($q$DELETE FROM private.catalog_requests_v1$q$,'23514','terminal requests retained');
DO $$ BEGIN
  BEGIN
    INSERT INTO private.catalog_requests_v1(actor_id,request_id,status,binding,fingerprint,write_columns)
      VALUES(md5('catalogue-write-actor-1')::uuid,md5('catalogue-write-pending-probe')::uuid,'pending',
        '{"operation":"edit","kind":"customer"}',repeat('a',64),ARRAY['name']);
    SET CONSTRAINTS private.catalog_request_no_pending_v1 IMMEDIATE;
    RAISE EXCEPTION 'Pending request escaped assertion';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.foundation_assert(NOT EXISTS(SELECT 1 FROM private.catalog_requests_v1 WHERE status='pending'),'no pending request at end');
SELECT pg_temp.foundation_assert((SELECT NOT tracking_ready FROM private.catalog_cutover_v1),'global tracking remains unready');
