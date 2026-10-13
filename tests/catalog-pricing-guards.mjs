import fs from 'node:fs';
const sql=fs.readFileSync('supabase/migrations/202610010010_nullable_catalog_prices.sql','utf8');
const body=sql.match(/DO \$preflight\$([\s\S]*?)\$preflight\$;/)?.[1];
if(!body||/\b(?:ALTER|INSERT|UPDATE|DELETE|COMMIT)\b/i.test(body))throw new Error('Expected read-only exact catalog preflight');
const cases=[
 ['GRANT EXECUTE ON FUNCTION public.pilot_order_transaction(uuid,text,jsonb) TO authenticated WITH GRANT OPTION;','Order transaction ACL/owner drift; migration refused'],
 ['GRANT EXECUTE ON FUNCTION public.pilot_order_transaction(uuid,text,jsonb) TO anon;','Order transaction ACL/owner drift; migration refused'],
 ['GRANT EXECUTE ON FUNCTION public.pilot_order_transaction(uuid,text,jsonb) TO PUBLIC;','Order transaction ACL/owner drift; migration refused'],
 ['REVOKE EXECUTE ON FUNCTION public.pilot_order_transaction(uuid,text,jsonb) FROM authenticated;','Order transaction ACL/owner drift; migration refused'],
 ['ALTER FUNCTION public.pilot_order_transaction(uuid,text,jsonb) OWNER TO authenticated;','Order transaction ACL/owner drift; migration refused'],
 ['ALTER TABLE public.products ALTER COLUMN unit_price DROP DEFAULT;','Catalog price column contract drift; migration refused'],
];
let packet=cases.map(([change,expected],i)=>`BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL search_path='';
DO $$ BEGIN IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable fixture required'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_catalog_contract() RETURNS void LANGUAGE plpgsql SET search_path='' AS $guard$${body}$guard$;
${change}
DO $check$ BEGIN
 BEGIN
  PERFORM pg_temp.assert_catalog_contract();
  RAISE EXCEPTION 'Unexpectedly accepted catalog contract drift';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'${expected}' THEN RAISE; END IF; END;
END $check$;
ROLLBACK;
SELECT 'CATALOG_CONTRACT_DRIFT_REJECTED_${i+1}' AS result;
`).join('\n');
if((sql.match(/^BEGIN;$/gm)||[]).length!==1||(sql.match(/^COMMIT;$/gm)||[]).length!==1||!sql.trimEnd().endsWith('COMMIT;'))throw new Error('Unexpected migration transaction envelope');
const atomicBody=sql.replace(/^BEGIN;\n/m,'').replace(/\nCOMMIT;\s*$/,'');
if(/^COMMIT;$/m.test(atomicBody))throw new Error('Probe must not commit');
packet+=`BEGIN;
SET LOCAL statement_timeout='60s';
DO $$ BEGIN IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable fixture required'; END IF; END $$;
INSERT INTO public.products(id,name,sku,unit_price,harga_pokok,luar_kota,dalam_kota,depo_bangunan)
VALUES('97000000-0000-0000-0000-000000000001','Synthetic pre-migration price probe','SYNTH-PRE-MIGRATION-PRICES',12.34,1.23,12.34,23.45,34.56);
${atomicBody}
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id='97000000-0000-0000-0000-000000000001' AND unit_price=12.34 AND harga_pokok=1.23 AND luar_kota=12.34 AND dalam_kota=23.45 AND depo_bangunan=34.56) THEN RAISE EXCEPTION 'Actual migration changed existing product prices'; END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.products'::regclass AND attname IN ('unit_price','harga_pokok','luar_kota','dalam_kota','depo_bangunan') AND NOT attnotnull AND NOT atthasdef)<>5 THEN RAISE EXCEPTION 'Actual migration did not remove null/default constraints'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.products WHERE id='97000000-0000-0000-0000-000000000001') OR EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='public.pricing_tier'::regtype AND enumlabel='others') THEN RAISE EXCEPTION 'Migration probe did not roll back'; END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.products'::regclass AND attname IN ('unit_price','harga_pokok','luar_kota','dalam_kota','depo_bangunan') AND attnotnull AND atthasdef)<>5 THEN RAISE EXCEPTION 'Migration probe column state not restored'; END IF;
END $$;
SELECT 'CATALOG_EXISTING_VALUES_ROLLBACK_VERIFIED' AS result;
`;
fs.mkdirSync('scale-results',{recursive:true});
fs.writeFileSync('scale-results/catalog-pricing-guards.sql',packet);
