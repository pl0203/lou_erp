// Pure, bounded SQL assembly. This module never connects to or changes a database.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
export const STALE_PO_MIGRATION='supabase/migrations/202610020003_stale_po_conflicts.sql'
const targets=[
 {signature:'public.pilot_order_transaction(uuid,text,jsonb)',before:'ab2271c853e3bfcb10bf2814d16cede0',after:'2fa378a5be5bfbed7dfdabfe8c6c420c',saving:true,security:true,volatility:'v'},
 {signature:'public.pilot_po_lines_v1(uuid,integer,integer,timestamp with time zone)',before:'e4a931ce4345ba9dd63a6ebd7dc52241',after:'d7b04bc2c54b075cda9dc5de7911d60d',saving:false,security:false,volatility:'s'},
]
const hash=(value,algorithm='sha256')=>createHash(algorithm).update(value).digest('hex')
const literal=value=>`'${String(value).replaceAll("'","''")}'`
const metadataKeys=['owner','acl','config','result','strict','language','parallel','arguments','identity_arguments','leakproof','volatility','security_definer']
const metadataSql=`jsonb_build_object('owner',p.proowner::regrole::text,'acl',p.proacl,'config',p.proconfig,'result',pg_get_function_result(p.oid),'strict',p.proisstrict,'language',l.lanname,'parallel',p.proparallel,'arguments',pg_get_function_arguments(p.oid),'identity_arguments',pg_get_function_identity_arguments(p.oid),'leakproof',p.proleakproof,'volatility',p.provolatile,'security_definer',p.prosecdef)`
function validatePreflight(preflight){
 if(!Array.isArray(preflight)||preflight.length!==2)throw new Error('Exactly two verified staging function snapshots required')
 return targets.map(target=>{
  const rows=preflight.filter(r=>r.signature===target.signature)
  if(rows.length!==1)throw new Error('Exact target signature required')
  const row=rows[0]
  if(row.database!=='postgres'||row.operator!=='postgres'||!row.present||row.source_md5!==target.before||row.owner!=='postgres'||row.language!=='plpgsql'||row.security_definer!==target.security||row.volatility!==target.volatility||JSON.stringify(row.config)!=='["search_path=\\\"\\\""]'||row.result!=='jsonb'||row.strict!==false||row.parallel!=='u'||row.leakproof!==false||row.custom_40001_raise_count!==1||row.custom_PT409_raise_count!==0)throw new Error('Reviewed staging function contract mismatch')
  if(!Array.isArray(row.acl)||JSON.stringify([...row.acl].sort())!==JSON.stringify(['postgres=X/postgres','authenticated=X/postgres','service_role=X/postgres'].sort()))throw new Error('Exact reviewed staging ACL required')
  if(typeof row.definition!=='string'||hash(row.definition,'md5')!==row.definition_md5)throw new Error('Full verified function definition required')
  const oldRaise=`RAISE EXCEPTION 'PO changed; refresh before ${target.saving?'saving':'continuing'}' USING ERRCODE='40001';`
  if(row.definition.split(oldRaise).length!==2)throw new Error('Exactly one complete custom stale raise required')
  return {...target,row,metadata:Object.fromEntries(metadataKeys.map(k=>[k,row[k]])),oldRaise,newRaise:oldRaise.replace("'40001'","'PT409'")}
 })
}
function exactGuard(rows,after=false){
 return `DO $exact_staging_state$ BEGIN\n IF current_database()<>'postgres' OR current_user<>'postgres' THEN RAISE EXCEPTION 'Reviewed staging database/operator required'; END IF;\n`+rows.map(t=>` IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(${literal(t.signature)}) AND md5(p.prosrc)=${literal(after?t.after:t.before)} AND ${metadataSql}=${literal(JSON.stringify(t.metadata))}::jsonb${after?'':` AND md5(pg_get_functiondef(p.oid))=${literal(t.row.definition_md5)}`}) THEN RAISE EXCEPTION 'Exact reviewed staging function drift; refused'; END IF;`).join('\n')+`\nEND $exact_staging_state$;\n`
}
export function buildStalePOConflictPacket({preflight,expectedProjectRef,repoRoot='.'}){
 if(expectedProjectRef!=='mqfpupsuthghubkeiuey')throw new Error('Only the independently verified staging project is allowed')
 const rows=validatePreflight(preflight),migration=readFileSync(`${repoRoot}/${STALE_PO_MIGRATION}`,'utf8')
 if(migration.split('\nBEGIN;\n').length!==2||migration.split('\nCOMMIT;\n').length!==2)throw new Error('Exact migration transaction envelope required')
 const core=migration.slice(migration.indexOf('\nBEGIN;\n')+8,migration.lastIndexOf('\nCOMMIT;\n'))
 const context=`-- STAGING ONLY: ${expectedProjectRef}. The label is not identity proof; verify the destination separately.\n-- Exact two-function patch; does not terminate sessions or change rows/policies/grants.\n`
 const apply=context+'BEGIN;\n'+exactGuard(rows)+core+'\n'+exactGuard(rows,true)+"COMMIT;\nSELECT 'STALE_PO_CONFLICT_HOTFIX_COMMITTED' AS receipt;\n"
 const rollback=context+'-- WARNING: restoring 40001 reintroduces the known retry risk. Execute only on a separately approved rollback.\nBEGIN;\nSET LOCAL lock_timeout=\'5s\';\nSET LOCAL statement_timeout=\'15s\';\nSET LOCAL search_path=\'\';\n'+exactGuard(rows,true)+`DO $rollback_stale_po$ DECLARE fn oid; before_metadata jsonb; definition text; BEGIN\n`+rows.map(t=>` fn:=to_regprocedure(${literal(t.signature)});\n SELECT to_jsonb(p)-'prosrc',pg_get_functiondef(p.oid) INTO before_metadata,definition FROM pg_proc p WHERE p.oid=fn;\n IF (length(definition)-length(replace(definition,${literal(t.newRaise)},'')))/length(${literal(t.newRaise)})<>1 THEN RAISE EXCEPTION 'Rollback stale raise drift; refused'; END IF;\n EXECUTE replace(definition,${literal(t.newRaise)},${literal(t.oldRaise)});\n IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=fn) IS DISTINCT FROM before_metadata THEN RAISE EXCEPTION 'Rollback metadata changed; refused'; END IF;`).join('\n')+`\nEND $rollback_stale_po$;\n`+exactGuard(rows)+"NOTIFY pgrst,'reload schema';\nCOMMIT;\nSELECT 'STALE_PO_CONFLICT_ROLLBACK_COMMITTED' AS receipt;\n"
 const postcheck=context+'BEGIN READ ONLY;\nSET LOCAL statement_timeout=\'15s\';\nSET LOCAL search_path=\'\';\n'+exactGuard(rows,true)+rows.map(t=>`SELECT jsonb_build_object('signature',${literal(t.signature)},'source_md5',md5(p.prosrc),'custom_40001_raise_count',(length(p.prosrc)-length(replace(p.prosrc,$code$ERRCODE='40001'$code$,'')))/length($code$ERRCODE='40001'$code$),'custom_PT409_raise_count',(length(p.prosrc)-length(replace(p.prosrc,$code$ERRCODE='PT409'$code$,'')))/length($code$ERRCODE='PT409'$code$),'metadata',${metadataSql}) AS verified_hotfix FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(${literal(t.signature)});`).join('\n')+'\nROLLBACK;\n'
 return {apply,rollback,postcheck,hashes:{migration:hash(migration),apply:hash(apply),rollback:hash(rollback),postcheck:hash(postcheck)},functions:rows.map(t=>({signature:t.signature,before:t.before,after:t.after}))}
}
