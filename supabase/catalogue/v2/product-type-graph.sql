-- Reviewed additive graph extension. Original body pins remain byte-for-byte intact.
-- Abort on any previously unknown deployed/source body; never rebuild from current inventory.
DO $extend$
DECLARE definition text; original_body text; changed text;
BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO definition,original_body
 FROM pg_catalog.pg_proc p WHERE p.oid='private.catalog_assert_checked_graph_v2()'::regprocedure;
 IF md5(original_body) NOT IN ('6155cb4ca3e236dfcd9eba04e75ce982','6ffafa0f145828f5917a360e8181212e') THEN
  RAISE EXCEPTION 'Checked graph changed; review required' USING ERRCODE='55000';
 END IF;
 changed:=replace(definition,' SELECT jsonb_agg(to_jsonb(e) ORDER BY relation,name) INTO expected FROM (VALUES',
 ' SELECT jsonb_agg(to_jsonb(e) ORDER BY relation,name) INTO expected FROM (VALUES'||E'\n'||$entries$ ('public.products','catalog_product_type_required_v2','private.catalog_product_type_required_v2()',23,'O',false,false,'','',NULL),
 ('public.products','catalog_product_type_edit_required_v2','private.catalog_product_type_edit_required_v2()',19,'O',false,false,'',
   (SELECT string_agg(a.attnum::text,' ' ORDER BY c.ord) FROM unnest(ARRAY['name','sku','size','unit_price','harga_pokok','luar_kota','dalam_kota','depo_bangunan','product_type']) WITH ORDINALITY c(name,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid='public.products'::regclass AND a.attname=c.name AND NOT a.attisdropped),NULL),
 ('public.products','catalog_record_product_type_v2','private.catalog_record_product_type_v2()',21,'O',false,false,'','',NULL),
 ('private.catalog_product_type_audit_v2','catalog_product_type_audit_immutable_v2','private.catalog_product_type_audit_immutable_v2()',27,'O',false,false,'','',NULL),
 ('private.catalog_product_type_audit_v2','catalog_product_type_audit_no_truncate_v2','private.catalog_product_type_audit_immutable_v2()',34,'O',false,false,'','',NULL),
$entries$);
 changed:=replace(changed,' FOR entry IN SELECT * FROM (VALUES',
 ' FOR entry IN SELECT * FROM (VALUES'||E'\n'||$hashes$ ('private.catalog_product_type_required_v2()','f3c4d1e31605bff6b0652ec1580cf92d7402f07cdf9547bedb4d197727105d02'),
 ('private.catalog_product_type_edit_required_v2()','b69d3d9235771693c9108b5368bd70cc2fff2240cc9b07623922bf0182dc040c'),
 ('private.catalog_record_product_type_v2()','62bf47fc0af40f1067083b9843a83370c023ccee1045dd9542af46f8296ac175'),
 ('private.catalog_product_type_audit_immutable_v2()','b58e12e3ecf8af5bbb641a68f7af9ea3640c9beac916276e913e041e659b2ff6'),
$hashes$);
 changed:=replace(changed,' INTO actual FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid=ANY(ARRAY[',
 ' INTO actual FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid=ANY(ARRAY['||E'\n'||'''private.catalog_product_type_audit_v2''::regclass,');
 changed:=replace(changed,'END $function$', $metadata$ FOR entry IN SELECT * FROM (VALUES
('private.catalog_product_type_required_v2()',false),('private.catalog_product_type_edit_required_v2()',false),('private.catalog_record_product_type_v2()',true),('private.catalog_product_type_audit_immutable_v2()',false)
 ) n(signature,security_definer) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=entry.signature::regprocedure
    AND p.prosecdef=entry.security_definer AND p.provolatile='v'
    AND p.proconfig=ARRAY['search_path=""']::text[]
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner)) THEN
   RAISE EXCEPTION 'Unreviewed Tipe guard metadata' USING ERRCODE='55000',DETAIL='CATALOG_TRACKING_INCOMPLETE';
  END IF;
 END LOOP;
$metadata$||'END $function$');
 IF changed=definition OR position('Unreviewed Tipe guard metadata' IN changed)=0 THEN
  RAISE EXCEPTION 'Checked graph transformation incomplete' USING ERRCODE='55000';
 END IF;
 EXECUTE changed;
END $extend$;
