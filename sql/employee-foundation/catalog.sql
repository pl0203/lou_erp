-- Catalog-only semantic comparison. No credentials or user row contents.
-- Call after topology.sql inside the reviewed transaction; helpers are temporary.
CREATE OR REPLACE FUNCTION pg_temp.employee_catalog(hr boolean) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $catalog$
WITH relations AS (
 SELECT c.*,n.nspname,format('%I.%I',n.nspname,c.relname) identity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN('public','private','auth','storage') AND c.relkind IN('r','p','v','m','S','f','i','I')
 AND pg_temp.employee_owned_object('pg_class'::regclass,c.oid)=hr
), funcs AS (
 SELECT p.*,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN('public','private','auth','storage') AND p.prokind IN('f','p') AND pg_temp.employee_owned_object('pg_proc'::regclass,p.oid)=hr
), bodies AS (
 SELECT jsonb_build_object(
 'functions',coalesce((SELECT jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',pg_temp.employee_acl(p.proacl),'kind',p.prokind,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'leakproof',p.proleakproof,'strict',p.proisstrict,'parallel',p.proparallel,'config',p.proconfig,'result',pg_get_function_result(p.oid),'arguments',pg_get_function_arguments(p.oid)) ORDER BY p.oid::regprocedure::text) FROM funcs p),'{}'),
 'relations',coalesce((SELECT jsonb_object_agg(c.identity,jsonb_build_object('kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'acl',pg_temp.employee_acl(c.relacl),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'options',c.reloptions,'persistence',c.relpersistence,
 'columns',coalesce((SELECT jsonb_agg(jsonb_build_object('name',a.attname,'number',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END,'default',pg_get_expr(d.adbin,d.adrelid),'acl',pg_temp.employee_acl(a.attacl)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'),
 'constraints',coalesce((SELECT jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid,true),'validated',x.convalidated,'deferrable',x.condeferrable,'deferred',x.condeferred) ORDER BY x.conname) FROM pg_constraint x WHERE x.conrelid=c.oid),'[]'),
 'indexes',coalesce((SELECT jsonb_agg(jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'clustered',i.indisclustered,'replica',i.indisreplident) ORDER BY pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid=c.oid),'[]'),
 'policies',coalesce((SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',ARRAY(SELECT CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END FROM unnest(p.polroles)r ORDER BY 1),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid),'[]'),
 'triggers',coalesce((SELECT jsonb_agg(jsonb_build_object('name',CASE WHEN t.tgisinternal THEN (SELECT conname FROM pg_constraint WHERE oid=t.tgconstraint)||':'||t.tgtype::text ELSE t.tgname END,'function',t.tgfoid::regprocedure::text,'definition',CASE WHEN t.tgisinternal THEN replace(pg_get_triggerdef(t.oid,true),quote_ident(t.tgname),'<internal>') ELSE pg_get_triggerdef(t.oid,true) END,'enabled',t.tgenabled,'internal',t.tgisinternal) ORDER BY t.tgtype,t.tgfoid::regprocedure::text,CASE WHEN t.tgisinternal THEN (SELECT conname FROM pg_constraint WHERE oid=t.tgconstraint) ELSE t.tgname END) FROM pg_trigger t WHERE t.tgrelid=c.oid AND (hr OR NOT pg_temp.employee_owned_object('pg_trigger'::regclass,t.oid))),'[]'),
 'rules',coalesce((SELECT jsonb_agg(jsonb_build_object('name',r.rulename,'definition',pg_get_ruledef(r.oid,true),'enabled',r.ev_enabled) ORDER BY r.rulename) FROM pg_rewrite r WHERE r.ev_class=c.oid),'[]'),
 'view',CASE WHEN c.relkind IN('v','m') THEN pg_get_viewdef(c.oid,true) END,
 'sequence',(SELECT jsonb_build_object('type',s.seqtypid::regtype::text,'start',s.seqstart,'increment',s.seqincrement,'max',s.seqmax,'min',s.seqmin,'cache',s.seqcache,'cycle',s.seqcycle) FROM pg_sequence s WHERE s.seqrelid=c.oid)) ORDER BY c.identity) FROM relations c),'{}'),
 'types',coalesce((SELECT jsonb_object_agg(format('%I.%I',n.nspname,t.typname),jsonb_build_object('kind',t.typtype,'owner',pg_get_userbyid(t.typowner),'acl',pg_temp.employee_acl(t.typacl),'notnull',t.typnotnull,'default',t.typdefault,'base',CASE WHEN t.typbasetype=0 THEN NULL ELSE t.typbasetype::regtype::text END,'enum',ARRAY(SELECT e.enumlabel FROM pg_enum e WHERE e.enumtypid=t.oid ORDER BY e.enumsortorder)) ORDER BY n.nspname,t.typname) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN('public','private','auth','storage') AND pg_temp.employee_owned_object('pg_type'::regclass,t.oid)=hr),'{}'),
 'dependencies',coalesce((SELECT jsonb_agg(jsonb_build_array(a.type,a.schema,a.identity,d.objsubid,b.type,b.schema,b.identity,d.refobjsubid,d.deptype) ORDER BY a.type,a.schema,a.identity,d.objsubid,b.type,b.schema,b.identity,d.refobjsubid,d.deptype)
 FROM pg_depend d CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid)a CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid)b
 WHERE a.schema IN('public','private','auth','storage') AND pg_temp.employee_owned_object(d.classid,d.objid)=hr
 AND NOT (d.classid='pg_trigger'::regclass AND EXISTS(SELECT 1 FROM pg_trigger t WHERE t.oid=d.objid AND t.tgisinternal))
 AND (hr OR NOT pg_temp.employee_owned_object(d.refclassid,d.refobjid))),'[]')
 ) value
)
SELECT value || CASE WHEN hr THEN '{}'::jsonb ELSE jsonb_build_object(
 'schemas',(SELECT jsonb_object_agg(nspname,jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',pg_temp.employee_acl(nspacl)) ORDER BY nspname) FROM pg_namespace WHERE nspname IN('public','private','auth','storage')),
 'roles',(SELECT jsonb_agg(to_jsonb(r)-'oid'-'rolpassword' ORDER BY rolname) FROM pg_roles r),
 'memberships',coalesce((SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor),admin_option,inherit_option,set_option) ORDER BY roleid,member,grantor) FROM pg_auth_members),'[]'),
 'defaultAcl',coalesce((SELECT jsonb_agg(jsonb_build_array(pg_get_userbyid(defaclrole),CASE WHEN defaclnamespace=0 THEN NULL ELSE defaclnamespace::regnamespace::text END,defaclobjtype,pg_temp.employee_acl(defaclacl)) ORDER BY defaclrole,defaclnamespace,defaclobjtype) FROM pg_default_acl),'[]'),
 'settings',coalesce((SELECT jsonb_agg(jsonb_build_array(CASE WHEN setdatabase=0 THEN NULL ELSE (SELECT datname FROM pg_database WHERE oid=setdatabase) END,CASE WHEN setrole=0 THEN NULL ELSE pg_get_userbyid(setrole) END,setconfig) ORDER BY setdatabase,setrole) FROM pg_db_role_setting WHERE setdatabase=0 OR setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database())),'[]'),
 'database',(SELECT jsonb_build_object('name',datname,'owner',pg_get_userbyid(datdba),'acl',pg_temp.employee_acl(datacl)) FROM pg_database WHERE datname=current_database()),
 'extensions',(SELECT jsonb_agg(jsonb_build_array(extname,extversion,pg_get_userbyid(extowner),extnamespace::regnamespace::text) ORDER BY extname) FROM pg_extension)
 ) END FROM bodies
$catalog$;
