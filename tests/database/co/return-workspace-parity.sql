-- Read-only exact snapshot of existing public/private authority/schema. No row data.
-- Excludes ONLY the additive return objects and their generated FK triggers.
WITH new_functions(schema,name) AS (VALUES
 ('private','co_return_workspace_page_v1'),('public','pilot_co_return_customers_v1'),('public','pilot_co_return_history_customers_v1'),
 ('public','pilot_co_return_items_v1'),('public','pilot_co_returns_page_v1'),('public','pilot_co_return_create_v1'),('public','pilot_co_return_create_result_v1')
), relations AS (
 SELECT c.oid,c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN('public','private') AND c.relkind IN('r','p','v','m','S') AND NOT(n.nspname='private' AND c.relname='co_return_workspace_requests')
), pieces AS (
 SELECT 'function' kind,n.nspname||'.'||p.oid::regprocedure::text identity,
 to_jsonb(p)||jsonb_build_object('definition',pg_get_functiondef(p.oid)) value
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','private') AND p.prokind='f' AND NOT EXISTS(SELECT 1 FROM new_functions f WHERE f.schema=n.nspname AND f.name=p.proname)
 UNION ALL
 SELECT 'relation',r.nspname||'.'||r.relname,jsonb_build_object('owner',c.relowner,'kind',c.relkind,'acl',c.relacl,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'options',c.reloptions)
 FROM relations r JOIN pg_class c ON c.oid=r.oid
 UNION ALL
 SELECT 'column',r.nspname||'.'||r.relname||'.'||a.attnum,to_jsonb(a)||jsonb_build_object('default',pg_get_expr(d.adbin,d.adrelid))
 FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum WHERE a.attnum>0
 UNION ALL
 SELECT 'constraint',r.nspname||'.'||r.relname||'.'||c.conname,to_jsonb(c)||jsonb_build_object('definition',pg_get_constraintdef(c.oid))
 FROM relations r JOIN pg_constraint c ON c.conrelid=r.oid
 UNION ALL
 SELECT 'policy',r.nspname||'.'||r.relname||'.'||p.polname,to_jsonb(p) FROM relations r JOIN pg_policy p ON p.polrelid=r.oid
 UNION ALL
 SELECT 'index',r.nspname||'.'||r.relname||'.'||i.indexrelid::regclass::text,to_jsonb(i)||jsonb_build_object('definition',pg_get_indexdef(i.indexrelid)) FROM relations r JOIN pg_index i ON i.indrelid=r.oid
 UNION ALL
 SELECT 'trigger',r.nspname||'.'||r.relname||'.'||t.tgname,to_jsonb(t)||jsonb_build_object('definition',pg_get_triggerdef(t.oid)) FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid
 WHERE NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN pg_class target ON target.oid=k.conrelid JOIN pg_namespace ns ON ns.oid=target.relnamespace WHERE k.oid=t.tgconstraint AND ns.nspname='private' AND target.relname='co_return_workspace_requests')
)
SELECT coalesce(jsonb_agg(jsonb_build_array(kind,identity,value) ORDER BY kind,identity),'[]'::jsonb)::text FROM pieces;
