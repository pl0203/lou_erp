import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { assembleReadRollout,loadApprovedReadSources } from './assemble-read-rollout.mjs'
export const ROLLOUT_TABLES=['users','customers','products','customer_manager_assignments','customer_sales_rep_assignments','customer_targets','sales_targets','sales_schedules','outlet_visits','visit_photos','purchase_orders','po_line_items','po_audit_log','promotions','girard_orders','girard_order_items','surat_jalan','sj_line_items','outlets','orders','order_line_items']
const targets=[...['po_line_items','po_audit_log','surat_jalan'].map(t=>[t,'pilot_po_visibility','parent']),['sj_line_items','pilot_parent_visibility','header'],...['purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items'].map(t=>[t,'pilot_active_profile','active'])]
const literal=s=>`'${s.replaceAll("'","''")}'`
function hash(value){if(!/^[a-f0-9]{32}$/.test(value))throw new Error('Verified32-character fingerprint required');return value}
function context(db,ref){if(db==='postgres'&&!/^[a-z]{20}$/.test(ref??''))throw new Error('Exact reviewed staging project reference required');return db==='postgres'?`-- Target label: ${ref}. Independently verify the management/API destination; this label is not identity proof.\n`:'-- Fixed ephemeral companion database only.\n'}
function database(value){if(!['postgres','pilot_rollout_test'].includes(value))throw new Error('Explicit reviewed database required');return value}
export function expectedReadFunctions(sources){
 const functions=new Map()
 for(const source of sources){const sql=typeof source==='string'?source:source.sql??source.content
  for(const m of sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION ((?:public|private)\.\w+)\(([^]*?)\) RETURNS [^]*?AS \$\$([^]*?)\$\$;/g)){
   const types=m[2].trim()?m[2].split(',').map(a=>a.trim().replace(/\s+DEFAULT[^]*/i,'').split(/\s+/).slice(1).join(' ')):[]
   const signature=`${m[1]}(${types.join(',')})`
   functions.set(signature,{signature,bodyHash:createHash('md5').update(m[3]).digest('hex')})
  }
 }
 if(functions.size!==15)throw new Error('Expected exactly15 read functions')
 return [...functions.values()]
}
const snapshot=(name,query)=>`CREATE TEMP TABLE ${name} AS ${query.trim().replace(/;$/,'')};\n`
const setup=db=>`SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path='';
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN IF current_database()<>${literal(database(db))} OR current_user<>'postgres' THEN RAISE EXCEPTION 'Reviewed database/operator required'; END IF; END $$;
LOCK TABLE ${ROLLOUT_TABLES.map(t=>'public.'+t).join(',')},private.pilot_order_requests IN SHARE MODE;
`
const dataCheck=(before,after)=>`IF (SELECT private_preflight->>'data_md5' FROM ${before}) IS DISTINCT FROM (SELECT private_preflight->>'data_md5' FROM ${after}) THEN RAISE EXCEPTION 'Data fingerprint changed; aborting read rollout'; END IF;`
export async function buildGuardedReadRollout({repoRoot,expectedDataHash,expectedSchemaHash,expectedDatabase,expectedProjectRef}){
 hash(expectedDataHash);hash(expectedSchemaHash)
 const sources=await loadApprovedReadSources(repoRoot),functions=expectedReadFunctions(sources)
 const query=readFileSync(`${repoRoot}/scripts/read-rollout-snapshot.sql`,'utf8')
 const before=context(expectedDatabase,expectedProjectRef)+setup(expectedDatabase)+snapshot('read_rollout_before',query)+`CREATE TEMP TABLE read_rollout_index_before AS SELECT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam WHERE i.indrelid='public.girard_orders'::regclass AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid='public.girard_orders'::regclass AND attname='po_id') AND i.indisvalid AND i.indisready AND i.indpred IS NULL AND i.indexprs IS NULL AND am.amname='btree') AS reusable;\nDO $$ BEGIN
 IF (SELECT private_preflight->>'data_md5' FROM read_rollout_before) IS DISTINCT FROM '${expectedDataHash}' OR (SELECT private_preflight->>'schema_md5' FROM read_rollout_before) IS DISTINCT FROM '${expectedSchemaHash}' THEN RAISE EXCEPTION 'Approved baseline fingerprint drift'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname=ANY(ARRAY[${functions.map(f=>literal(f.signature.split('(')[0])).join(',')}])) THEN RAISE EXCEPTION 'Read function already exists; reconcile before apply'; END IF;
END $$;
`
 const after=`SET LOCAL search_path='';
SET LOCAL TIME ZONE 'UTC';
`+snapshot('read_rollout_after',query)+`CREATE TEMP TABLE read_rollout_functions(signature text PRIMARY KEY,body_md5 text);
INSERT INTO read_rollout_functions VALUES ${functions.map(f=>`(${literal(f.signature)}::regprocedure::text,'${f.bodyHash}')`).join(',')};
CREATE TEMP TABLE read_rollout_targets(table_name text,policy_name text,shape text);
INSERT INTO read_rollout_targets VALUES ${targets.map(t=>'('+t.map(literal).join(',')+')').join(',')};
CREATE TEMP TABLE read_rollout_shapes(purchase_order_id uuid,surat_jalan_id uuid);
CREATE POLICY parent ON read_rollout_shapes USING(purchase_order_id IN(SELECT p.id FROM public.purchase_orders p));
CREATE POLICY header ON read_rollout_shapes USING(surat_jalan_id IN(SELECT s.id FROM public.surat_jalan s));
CREATE POLICY active ON read_rollout_shapes USING((SELECT public.current_user_role()) IS NOT NULL) WITH CHECK((SELECT public.current_user_role()) IS NOT NULL);
DO $$ DECLARE b jsonb;a jsonb; created_indexes integer; BEGIN
 SELECT private_preflight->'schema' INTO b FROM read_rollout_before;SELECT private_preflight->'schema' INTO a FROM read_rollout_after;
 ${dataCheck('read_rollout_before','read_rollout_after')}
 IF b-'functions'-'policies'-'indexes' IS DISTINCT FROM a-'functions'-'policies'-'indexes' THEN RAISE EXCEPTION 'Untargeted schema/ACL/trigger drift'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(b->'functions') f WHERE NOT(a->'functions' @> jsonb_build_array(f))) OR jsonb_array_length(a->'functions')<>jsonb_array_length(b->'functions')+15 THEN RAISE EXCEPTION 'Unexpected function metadata delta'; END IF;
 IF EXISTS(SELECT 1 FROM read_rollout_functions e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) WHERE p.oid IS NULL OR md5(p.prosrc)<>e.body_md5 OR p.prosecdef OR p.provolatile<>'s' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proowner<>(SELECT oid FROM pg_roles WHERE rolname='postgres') OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE') OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE (acl.grantee<>p.proowner AND NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid=acl.grantee AND r.rolname IN('authenticated','service_role'))) OR (acl.is_grantable AND acl.grantee<>p.proowner))) THEN RAISE EXCEPTION 'Read function body/security/ACL mismatch'; END IF;
 IF (SELECT jsonb_agg(p ORDER BY p::text) FROM jsonb_array_elements(b->'policies')p WHERE NOT EXISTS(SELECT 1 FROM read_rollout_targets t WHERE p->>'schemaname'='public' AND p->>'tablename'=t.table_name AND p->>'policyname'=t.policy_name)) IS DISTINCT FROM (SELECT jsonb_agg(p ORDER BY p::text) FROM jsonb_array_elements(a->'policies')p WHERE NOT EXISTS(SELECT 1 FROM read_rollout_targets t WHERE p->>'schemaname'='public' AND p->>'tablename'=t.table_name AND p->>'policyname'=t.policy_name)) THEN RAISE EXCEPTION 'Untargeted policy delta'; END IF;
 IF (SELECT count(*) FROM read_rollout_targets t JOIN pg_policies p ON p.schemaname='public' AND p.tablename=t.table_name AND p.policyname=t.policy_name)<>9 THEN RAISE EXCEPTION 'Missing target policy'; END IF;
 IF EXISTS(SELECT 1 FROM read_rollout_targets t JOIN pg_policies p ON p.schemaname='public' AND p.tablename=t.table_name AND p.policyname=t.policy_name JOIN pg_policies expected ON expected.schemaname=(SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema()) AND expected.tablename='read_rollout_shapes' AND expected.policyname=t.shape WHERE regexp_replace(p.qual,'\\s','','g') IS DISTINCT FROM regexp_replace(expected.qual,'\\s','','g') OR regexp_replace(p.with_check,'\\s','','g') IS DISTINCT FROM regexp_replace(expected.with_check,'\\s','','g')) THEN RAISE EXCEPTION 'Target policy expression mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM read_rollout_targets t CROSS JOIN LATERAL(SELECT p FROM jsonb_array_elements(b->'policies')p WHERE p->>'schemaname'='public' AND p->>'tablename'=t.table_name AND p->>'policyname'=t.policy_name)old JOIN pg_policies p ON p.schemaname='public' AND p.tablename=t.table_name AND p.policyname=t.policy_name WHERE old.p-'qual'-'with_check' IS DISTINCT FROM to_jsonb(p)-'qual'-'with_check') THEN RAISE EXCEPTION 'Policy identity/roles/command changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(b->'indexes')i WHERE NOT(a->'indexes' @> jsonb_build_array(i))) THEN RAISE EXCEPTION 'Existing index changed'; END IF;
 SELECT count(*) INTO created_indexes FROM jsonb_array_elements(a->'indexes')i WHERE NOT(b->'indexes' @> jsonb_build_array(i));
 IF created_indexes IS DISTINCT FROM (SELECT CASE WHEN reusable THEN 0 ELSE 1 END FROM read_rollout_index_before) OR EXISTS(SELECT 1 FROM jsonb_array_elements(a->'indexes')added WHERE NOT(b->'indexes' @> jsonb_build_array(added)) AND added->>'name' IS DISTINCT FROM 'public.pilot_girard_orders_po_id_idx') OR (created_indexes=1 AND NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam WHERE i.indexrelid=to_regclass('public.pilot_girard_orders_po_id_idx') AND i.indrelid='public.girard_orders'::regclass AND c.relowner=(SELECT relowner FROM pg_class WHERE oid='public.girard_orders'::regclass) AND NOT i.indisunique AND NOT i.indisprimary AND i.indisvalid AND i.indisready AND i.indnkeyatts=1 AND i.indnatts=1 AND i.indpred IS NULL AND i.indexprs IS NULL AND am.amname='btree' AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid='public.girard_orders'::regclass AND attname='po_id'))) THEN RAISE EXCEPTION 'Unexpected index delta'; END IF;
END $$;
`
 const assembled=assembleReadRollout({sources,beforeSql:before,afterSql:after+"NOTIFY pgrst,'reload schema';\n"})
 const receipt=`SELECT jsonb_build_object('result','READ_ROLLOUT_COMMITTED','before_schema_md5',(SELECT private_preflight->>'schema_md5' FROM read_rollout_before),'after_schema_md5',private_preflight->>'schema_md5','data_md5',private_preflight->>'data_md5','index_created',(SELECT jsonb_array_length(private_preflight->'schema'->'indexes') FROM read_rollout_after)>(SELECT jsonb_array_length(private_preflight->'schema'->'indexes') FROM read_rollout_before)) AS rollout_receipt FROM read_rollout_after;\n`
 const sql=assembled.sql+'\n'+receipt
 return {...assembled,transactionSql:assembled.sql,sql,checks:{...assembled.checks,transactionSha256:assembled.checks.assembledSha256,assembledSha256:createHash('sha256').update(sql).digest('hex')}}
}

export async function buildGuardedReadRollback({repoRoot,expectedSchemaHash,baselineSchemaHash,expectedDatabase,indexCreated,expectedProjectRef}){
 hash(expectedSchemaHash);hash(baselineSchemaHash)
 if(typeof indexCreated!=='boolean')throw new Error('Verified index provenance required')
 const functions=expectedReadFunctions(await loadApprovedReadSources(repoRoot))
 const query=readFileSync(`${repoRoot}/scripts/read-rollout-snapshot.sql`,'utf8')
 const restore=[...['po_line_items','po_audit_log','surat_jalan'].map(t=>`ALTER POLICY pilot_po_visibility ON public.${t} USING(private.pilot_can_read_po(purchase_order_id));`),
 'ALTER POLICY pilot_parent_visibility ON public.sj_line_items USING(EXISTS(SELECT 1 FROM public.surat_jalan sj WHERE sj.id=sj_line_items.surat_jalan_id));',
 ...['purchase_orders','po_line_items','po_audit_log','surat_jalan','sj_line_items'].map(t=>`ALTER POLICY pilot_active_profile ON public.${t} USING(public.current_user_role() IS NOT NULL) WITH CHECK(public.current_user_role() IS NOT NULL);`)].join('\n')
 const drop=[...functions.filter(f=>f.signature.startsWith('public.')),...functions.filter(f=>f.signature.startsWith('private.')).reverse()].map(f=>`DROP FUNCTION ${f.signature} RESTRICT;`).join('\n')
 return `BEGIN;
${context(expectedDatabase,expectedProjectRef)}${setup(expectedDatabase)}${snapshot('read_rollback_before',query)}DO $$ BEGIN
 IF (SELECT private_preflight->>'schema_md5' FROM read_rollback_before) IS DISTINCT FROM '${expectedSchemaHash}' THEN RAISE EXCEPTION 'Confirmed post-apply schema drift; rollback refused'; END IF;
END $$;
${restore}
${drop}
${indexCreated?`DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_am am ON am.oid=c.relam WHERE i.indexrelid=to_regclass('public.pilot_girard_orders_po_id_idx') AND i.indrelid='public.girard_orders'::regclass AND c.relowner=(SELECT relowner FROM pg_class WHERE oid='public.girard_orders'::regclass) AND NOT i.indisunique AND NOT i.indisprimary AND i.indisvalid AND i.indisready AND i.indnkeyatts=1 AND i.indnatts=1 AND i.indpred IS NULL AND i.indexprs IS NULL AND am.amname='btree' AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid='public.girard_orders'::regclass AND attname='po_id')) THEN RAISE EXCEPTION 'Created index definition drift'; END IF;
END $$;
DROP INDEX public.pilot_girard_orders_po_id_idx RESTRICT;`: '-- Apply receipt records index reuse; no index is removed.'}
${snapshot('read_rollback_after',query)}DO $$ BEGIN
 ${dataCheck('read_rollback_before','read_rollback_after')}
 IF (SELECT private_preflight->>'schema_md5' FROM read_rollback_after) IS DISTINCT FROM '${baselineSchemaHash}' THEN RAISE EXCEPTION 'Rollback did not restore exact baseline metadata'; END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT jsonb_build_object('result','READ_ROLLBACK_COMMITTED','schema_md5',private_preflight->>'schema_md5','data_md5',private_preflight->>'data_md5') AS rollback_receipt FROM read_rollback_after;
`
}

export async function assertGuardedReadRollout({sql,...options}){
 const expected=await buildGuardedReadRollout(options)
 if(sql!==expected.sql)throw new Error('Final guarded rollout artifact differs from reviewed assembly')
 return expected.checks
}
