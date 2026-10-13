-- Metadata only. Run on the independently verified staging project, never against production.
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL search_path='';
SET LOCAL TIME ZONE 'UTC';
WITH targets(signature,expected_stale_raise_count) AS (VALUES
 ('public.pilot_po_lines_v1(uuid,integer,integer,timestamp with time zone)',1),
 ('public.pilot_order_transaction(uuid,text,jsonb)',1)
)
SELECT jsonb_build_object(
 'database',current_database(),'operator',current_user,
 'signature',t.signature,'present',p.oid IS NOT NULL,
 'identity_arguments',pg_get_function_identity_arguments(p.oid),
 'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
 'owner',p.proowner::regrole::text,'acl',p.proacl,
 'acl_expanded',(SELECT jsonb_agg(jsonb_build_object('grantor',a.grantor::regrole::text,'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type,a.grantor) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a),
 'language',l.lanname,'security_definer',p.prosecdef,'volatility',p.provolatile,
 'strict',p.proisstrict,'parallel',p.proparallel,'leakproof',p.proleakproof,
 'config',p.proconfig,'source_md5',md5(p.prosrc),'definition_md5',md5(pg_get_functiondef(p.oid)),
 'custom_40001_raise_count',(length(p.prosrc)-length(replace(p.prosrc,$needle$ERRCODE='40001'$needle$,'')))/length($needle$ERRCODE='40001'$needle$),
 'custom_PT409_raise_count',(length(p.prosrc)-length(replace(p.prosrc,$needle$ERRCODE='PT409'$needle$,'')))/length($needle$ERRCODE='PT409'$needle$),
 'expected_stale_raise_count',t.expected_stale_raise_count,
 'definition',pg_get_functiondef(p.oid)
) AS stale_po_conflict_preflight
FROM targets t LEFT JOIN pg_proc p ON p.oid=to_regprocedure(t.signature)
LEFT JOIN pg_language l ON l.oid=p.prolang ORDER BY t.signature;
ROLLBACK;
