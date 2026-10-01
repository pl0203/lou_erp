WITH data_state AS (
SELECT 'public.users' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.users r
UNION ALL
SELECT 'public.customers' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.customers r
UNION ALL
SELECT 'public.products' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.products r
UNION ALL
SELECT 'public.customer_manager_assignments' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.customer_manager_assignments r
UNION ALL
SELECT 'public.customer_sales_rep_assignments' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.customer_sales_rep_assignments r
UNION ALL
SELECT 'public.customer_targets' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.customer_targets r
UNION ALL
SELECT 'public.sales_targets' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.sales_targets r
UNION ALL
SELECT 'public.sales_schedules' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.sales_schedules r
UNION ALL
SELECT 'public.outlet_visits' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.outlet_visits r
UNION ALL
SELECT 'public.visit_photos' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.visit_photos r
UNION ALL
SELECT 'public.purchase_orders' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.purchase_orders r
UNION ALL
SELECT 'public.po_line_items' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.po_line_items r
UNION ALL
SELECT 'public.po_audit_log' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.po_audit_log r
UNION ALL
SELECT 'public.promotions' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.promotions r
UNION ALL
SELECT 'public.girard_orders' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.girard_orders r
UNION ALL
SELECT 'public.girard_order_items' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.girard_order_items r
UNION ALL
SELECT 'public.surat_jalan' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.surat_jalan r
UNION ALL
SELECT 'public.sj_line_items' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.sj_line_items r
UNION ALL
SELECT 'public.outlets' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.outlets r
UNION ALL
SELECT 'public.orders' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.orders r
UNION ALL
SELECT 'public.order_line_items' AS relation,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) AS content_md5 FROM public.order_line_items r
UNION ALL
SELECT 'private.pilot_order_requests',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY md5(to_jsonb(r)::text)),'')) FROM private.pilot_order_requests r
UNION ALL
SELECT 'auth.users-safe-fields',count(*),md5(coalesce(string_agg(md5(jsonb_build_object('id',id,'email',email,'role',role,'aud',aud,'created_at',created_at)::text),'' ORDER BY id),'')) FROM auth.users
UNION ALL
SELECT 'storage.objects',count(*),md5(coalesce(string_agg(md5(jsonb_build_object('id',id,'bucket_id',bucket_id,'name',name,'owner_id',owner_id,'metadata',metadata)::text),'' ORDER BY id),'')) FROM storage.objects
UNION ALL
SELECT 'storage.buckets',count(*),md5(coalesce(string_agg(md5(to_jsonb(r)::text),'' ORDER BY id),'')) FROM storage.buckets r
), schema_state AS (
SELECT jsonb_build_object(
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) ORDER BY nspname) FROM pg_namespace WHERE nspname IN('public','private','storage')),
 'tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl::text) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','storage') AND c.relkind='r'),
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',a.attrelid::regclass::text,'number',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',(SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum),'acl',a.attacl::text) ORDER BY a.attrelid::regclass::text,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','storage') AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped),
 'enums',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'type',t.typname,'label',e.enumlabel,'order',e.enumsortorder) ORDER BY n.nspname,t.typname,e.enumsortorder) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN('public','private')),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'validated',c.convalidated,'definition',pg_get_constraintdef(c.oid)) ORDER BY c.conrelid::regclass::text,c.conname) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN('public','private','storage')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN('public','private','storage')),
 'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'volatility',p.provolatile,'definer',p.prosecdef,'leakproof',p.proleakproof,'strict',p.proisstrict,'parallel',p.proparallel,'config',p.proconfig,'acl',p.proacl::text,'arguments',pg_get_function_arguments(p.oid),'returns',pg_get_function_result(p.oid),'body_md5',md5(p.prosrc)) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN('public','private') AND p.prokind='f'),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) ORDER BY t.tgrelid::regclass::text,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','storage') AND NOT t.tgisinternal),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('table',i.indrelid::regclass::text,'name',i.indexrelid::regclass::text,'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid::regclass::text) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','private','storage')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'bypass_rls',rolbypassrls) ORDER BY rolname) FROM pg_roles WHERE rolname IN('anon','authenticated')),
 'memberships',(SELECT jsonb_agg(jsonb_build_object('member',pg_get_userbyid(m.member),'role',pg_get_userbyid(m.roleid),'admin_option',m.admin_option) ORDER BY m.member,m.roleid) FROM pg_auth_members m WHERE m.member IN(SELECT oid FROM pg_roles WHERE rolname IN('anon','authenticated'))),
 'auth_uid',(SELECT jsonb_build_object('volatility',provolatile,'definer',prosecdef,'returns',prorettype::regtype::text,'args',pronargs) FROM pg_proc WHERE oid='auth.uid()'::regprocedure)
) AS value
), fingerprints AS (SELECT jsonb_object_agg(relation,jsonb_build_object('rows',rows,'content_md5',content_md5) ORDER BY relation) AS value FROM data_state)
SELECT jsonb_build_object('captured_at',clock_timestamp(),'database',current_database(),'operator',current_user,'server_version',version(),'data',d.value,'data_md5',md5(d.value::text),'schema',s.value,'schema_md5',md5(s.value::text)) AS private_preflight
FROM schema_state s CROSS JOIN fingerprints d;
