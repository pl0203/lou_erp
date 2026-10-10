-- Metadata only. No Auth rows, credentials or private HR row contents.
-- pg_temp.demo_data and pg_temp.demo_columns hold only fingerprints/column names.
WITH entities AS (
 SELECT 'schema:'||nspname AS key,jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text) AS value FROM pg_namespace WHERE nspname IN('public','private','storage')
 UNION ALL SELECT 'table:'||n.nspname||'.'||c.relname,jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text,'options',c.reloptions) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','storage') AND c.relkind IN('r','p','v','m','S')
 UNION ALL SELECT 'column:'||n.nspname||'.'||c.relname||'.'||a.attname,jsonb_build_object('number',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',(SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum),'acl',a.attacl::text,'collation',a.attcollation::regcollation::text) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','storage') AND c.relkind IN('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'enum:'||n.nspname||'.'||t.typname||'.'||e.enumlabel,jsonb_build_object('order',e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN('public','private','storage')
 UNION ALL SELECT 'constraint:'||c.conrelid::regclass::text||'.'||c.conname,jsonb_build_object('validated',c.convalidated,'definition',pg_get_constraintdef(c.oid)) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN('public','private','storage')
 UNION ALL SELECT 'policy:'||schemaname||'.'||tablename||'.'||policyname,to_jsonb(p) FROM pg_policies p WHERE schemaname IN('public','private','storage')
 UNION ALL SELECT 'function:'||p.oid::regprocedure::text,jsonb_build_object('owner',pg_get_userbyid(p.proowner),'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text,'kind',p.prokind,'cost',p.procost,'rows',p.prorows,'support',p.prosupport::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private','storage') AND p.prokind IN('f','p')
 UNION ALL SELECT 'trigger:'||t.tgrelid::regclass::text||'.'||t.tgname,jsonb_build_object('enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','storage') AND NOT t.tgisinternal
 UNION ALL SELECT 'index:'||i.indexrelid::regclass::text,jsonb_build_object('valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'definition',pg_get_indexdef(i.indexrelid)) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','storage')
 UNION ALL SELECT 'sequence:'||schemaname||'.'||sequencename,to_jsonb(s)-'last_value' FROM pg_sequences s WHERE schemaname IN('public','private','storage')
 UNION ALL SELECT 'role:'||rolname,to_jsonb(r)-'oid'-'rolpassword' FROM pg_roles r WHERE rolname IN('anon','authenticated','service_role','postgres')
 UNION ALL SELECT 'membership:'||pg_get_userbyid(member)||'.'||pg_get_userbyid(roleid)||'.'||pg_get_userbyid(grantor),jsonb_build_object('admin',admin_option,'inherit',inherit_option,'set',set_option) FROM pg_auth_members WHERE member IN(SELECT oid FROM pg_roles WHERE rolname IN('anon','authenticated','service_role','postgres'))
 UNION ALL SELECT 'default_acl:'||pg_get_userbyid(d.defaclrole)||'.'||coalesce(n.nspname,'*')||'.'||d.defaclobjtype::text,jsonb_build_object('acl',d.defaclacl::text) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
 UNION ALL SELECT 'auth_uid:auth.uid()',jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl::text,'owner',pg_get_userbyid(p.proowner)) FROM pg_proc p WHERE p.oid=to_regprocedure('auth.uid()')
), metadata AS (
 SELECT coalesce(jsonb_object_agg(key,md5(value::text) ORDER BY key),'{}'::jsonb) AS value FROM entities
), fingerprints AS (
 SELECT coalesce(jsonb_object_agg(relation,jsonb_build_object('rows',rows,'content_md5',content_md5) ORDER BY relation),'{}'::jsonb) AS value FROM pg_temp.demo_data
)
SELECT jsonb_build_object('database',current_database(),'operator',current_user,
 'columns',(SELECT jsonb_object_agg(relation,columns ORDER BY relation) FROM pg_temp.demo_columns),
 'data',d.value,'data_md5',md5(d.value::text),'schema',s.value,'schema_md5',md5(s.value::text),
 'new_tables',(SELECT jsonb_object_agg(relation,jsonb_build_object('present',present,'rows',rows,'unresolved_requests',unresolved_requests) ORDER BY relation) FROM pg_temp.demo_new_data),
 'generic_additions_ok',NOT EXISTS(
  SELECT 1 FROM (VALUES
   ('public.purchase_orders','sales_person_id_at_creation','uuid',false,NULL::text),
   ('public.purchase_orders','sales_assignment_source_id','uuid',false,NULL::text),
   ('public.purchase_orders','sales_attributed_at','timestamp with time zone',false,NULL::text),
   ('public.purchase_orders','sales_attribution_state','text',true,'''legacy''::text'),
   ('public.po_line_items','product_id','uuid',false,NULL::text)
  ) expected(relation,name,type,required,default_expr)
  LEFT JOIN pg_attribute a ON a.attrelid=to_regclass(expected.relation) AND a.attname=expected.name AND a.attnum>0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod)<>expected.type OR a.attnotnull IS DISTINCT FROM expected.required
   OR a.attacl IS NOT NULL OR a.attidentity<>'' OR a.attgenerated<>'' OR pg_get_expr(d.adbin,d.adrelid) IS DISTINCT FROM expected.default_expr),
 'promotion_bucket',(SELECT jsonb_build_object('name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',(SELECT jsonb_agg(m ORDER BY m) FROM unnest(allowed_mime_types) m)) FROM storage.buckets WHERE id='promotion-images'),
 'additive_defaults_ok',(
 NOT EXISTS(SELECT 1 FROM private.pilot_order_requests r WHERE to_jsonb(r)->>'execution_version' IS DISTINCT FROM '0')
 AND NOT EXISTS(SELECT 1 FROM public.po_line_items r WHERE to_jsonb(r)->>'product_id' IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.purchase_orders r WHERE to_jsonb(r)->>'sales_attribution_state' IS DISTINCT FROM 'legacy' OR to_jsonb(r)->>'sales_person_id_at_creation' IS NOT NULL OR to_jsonb(r)->>'sales_assignment_source_id' IS NOT NULL OR to_jsonb(r)->>'sales_attributed_at' IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.promotions r WHERE to_jsonb(r)->>'stock_managed' IS DISTINCT FROM 'false' OR to_jsonb(r)->>'remaining_quantity' IS DISTINCT FROM '0' OR to_jsonb(r)->>'stock_version' IS DISTINCT FROM '1' OR to_jsonb(r)->>'image_path' IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.sales_schedules r WHERE to_jsonb(r)->>'version' IS DISTINCT FROM '1')
 AND NOT EXISTS(SELECT 1 FROM public.outlet_visits r WHERE to_jsonb(r)->>'note_version' IS DISTINCT FROM '1')),
 'pending_girard',(SELECT count(*) FROM public.girard_orders WHERE status='pending'),
 'unresolved_requests',(SELECT count(*) FROM private.pilot_order_requests WHERE result IS NULL AND NOT abandoned)) AS state
FROM metadata s CROSS JOIN fingerprints d
