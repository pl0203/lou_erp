-- READ-ONLY INVENTORY ONLY. The controller must select project mqfpupsuthghubkeiuey.
-- SQL cannot prove the connector's project identity. No apply, fixtures or account setup.
-- Prepared from committed d269efabc7c68335e139b6aa950aaa4c0e868ec4, not Task 12 working files.
-- Protected inventory: the runner's exact 41 tables; authority data: three additional projections.
-- Functions: 23 access rewrites, three replacements, nine existing authority dependencies.
-- query_to_xml executes only internally assembled SELECTs for this fixed relation allowlist.
-- It avoids parse-time references to missing schemas/tables and never returns underlying rows.
-- One JSON envelope. Catalog definitions/configuration/defaults are hashed, not disclosed.
-- Only safe function settings and precise authority/column/bucket metadata are rendered.
-- Data hash: SHA256 of sorted fixed-width per-row SHA256 hex, duplicate rows retained.
-- A timeout/permission error is an unavailable snapshot, never permission to omit a section.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';
SET LOCAL IntervalStyle = 'iso_8601';
SET LOCAL extra_float_digits = 3;
SET LOCAL bytea_output = 'hex';
SET LOCAL standard_conforming_strings = on;

WITH
required_functions(signature) AS (VALUES
  ('auth.uid()'),
  ('private.demo_can_upload_promotion(text,text)'),
  ('private.demo_order_actor()'),
  ('private.demo_promotion_path(text,uuid,uuid)'),
  ('private.pilot_admin_sales_source_v1(timestamptz,timestamptz)'),
  ('private.pilot_admin_sales_start_v1(uuid)'),
  ('private.pilot_can_access_actor(uuid)'),
  ('private.pilot_can_access_customer(uuid)'),
  ('private.pilot_can_read_po(uuid)'),
  ('private.pilot_canonical_sales_source_v1(timestamptz,timestamptz)'),
  ('private.pilot_performance_scope_v1(uuid,text)'),
  ('private.pilot_store_in_manager_scope_v1(uuid,uuid)'),
  ('private.pilot_store_owner_guard_v1()'),
  ('public.current_user_role()'),
  ('public.pilot_assign_store_owner_v1(uuid,uuid,uuid,bigint)'),
  ('public.pilot_athel_daily_v1(date,date,date,text,text,integer,integer)'),
  ('public.pilot_athel_summary_v1(date,date,date,text,text)'),
  ('public.pilot_customer_performance_v1(uuid,text,timestamptz,timestamptz,integer,integer)'),
  ('public.pilot_customer_stats_v1(uuid[],date,integer)'),
  ('public.pilot_manager_customers_v1(uuid,timestamptz,timestamptz,integer,integer)'),
  ('public.pilot_my_profile()'),
  ('public.pilot_order_transaction(uuid,text,jsonb)'),
  ('public.pilot_po_lines_v1(uuid,integer,integer,timestamptz)'),
  ('public.pilot_po_page_v1(text,text,integer,integer)'),
  ('public.pilot_promotion_image_v1(uuid)'),
  ('public.pilot_promotion_transaction_v1(uuid,text,jsonb)'),
  ('public.pilot_promotions_v1(boolean)'),
  ('public.pilot_reconcile_promotion_v1(uuid,boolean)'),
  ('public.pilot_reconcile_request(uuid,boolean)'),
  ('public.pilot_revenue_v1(timestamptz,timestamptz,integer,integer)'),
  ('public.pilot_sales_order_page_v1(text,boolean,integer,integer,uuid,uuid)'),
  ('public.pilot_sales_performance_v1(uuid,date,date,timestamptz,timestamptz,text,integer,integer)'),
  ('public.pilot_sales_report_months_v1(uuid)'),
  ('public.pilot_store_po_context_v1(uuid,integer,integer)'),
  ('public.pilot_team_activity_v1(uuid[],date,timestamptz,timestamptz,timestamptz)')
),
protected_names(name) AS (VALUES
  ('private.ihr_leave_access_manifests'),
  ('private.ihr_leave_calendar_registry'),
  ('private.ihr_leave_cancellation_attempts'),
  ('private.ihr_leave_cancellation_decisions'),
  ('private.ihr_leave_charge_reversals'),
  ('private.ihr_leave_commands'),
  ('private.ihr_leave_governance_approvals'),
  ('private.ihr_leave_governance_references'),
  ('private.ihr_leave_policy_owners'),
  ('private.ihr_leave_request_events'),
  ('private.ihr_leave_request_reassignments'),
  ('private.ihr_leave_scope_revision'),
  ('private.pilot_promo_movements'),
  ('private.pilot_promo_slices'),
  ('private.pilot_promotion_requests'),
  ('private.pilot_store_credit_corrections_v1'),
  ('private.pilot_store_owner_audit_v1'),
  ('public.girard_order_items'),
  ('public.girard_orders'),
  ('public.ihr_leave_access_grants'),
  ('public.ihr_leave_accounts'),
  ('public.ihr_leave_admin_events'),
  ('public.ihr_leave_approvers'),
  ('public.ihr_leave_calendar_exceptions'),
  ('public.ihr_leave_calendars'),
  ('public.ihr_leave_ledger'),
  ('public.ihr_leave_members'),
  ('public.ihr_leave_occupancy'),
  ('public.ihr_leave_policies'),
  ('public.ihr_leave_request_allocations'),
  ('public.ihr_leave_request_days'),
  ('public.ihr_leave_requests'),
  ('public.ihr_saturday_groups'),
  ('public.ihr_saturday_memberships'),
  ('public.ihr_saturday_roster'),
  ('public.po_audit_log'),
  ('public.po_line_items'),
  ('public.promotions'),
  ('public.purchase_orders'),
  ('public.sj_line_items'),
  ('public.surat_jalan')
),
authority_names(name, fields) AS (VALUES
  ('public.users', ARRAY['id','role','is_active','manager_id']::text[]),
  ('public.customer_manager_assignments', NULL::text[]),
  ('public.customer_sales_rep_assignments', NULL::text[])
),
-- These are the existing direct-table boundaries changed or relied upon by CO access.
authority_surface_names(name) AS (VALUES
  ('public.users'), ('public.customers'), ('public.products'),
  ('public.customer_manager_assignments'), ('public.customer_sales_rep_assignments'),
  ('public.customer_targets'), ('public.sales_targets'), ('public.sales_schedules'),
  ('public.visit_requests'), ('public.outlet_visits'), ('public.visit_photos'),
  ('public.girard_orders'), ('public.girard_order_items'), ('public.orders'),
  ('public.order_line_items'), ('public.outlets'), ('public.promotions'),
  ('public.purchase_orders'), ('public.po_line_items'), ('public.po_audit_log'),
  ('public.surat_jalan'), ('public.sj_line_items'), ('storage.objects'), ('storage.buckets')
),
required_columns(relation_name, column_name) AS (VALUES
  ('public.users','id'), ('public.users','role'), ('public.users','is_active'),
  ('public.users','manager_id'), ('public.products','name'), ('public.products','sku'),
  ('storage.objects','id'), ('storage.objects','bucket_id'), ('storage.objects','name'),
  ('storage.objects','version'), ('storage.objects','is_delete_marker'),
  ('storage.objects','metadata'), ('storage.buckets','id'), ('storage.buckets','name'),
  ('storage.buckets','public'), ('storage.buckets','file_size_limit'),
  ('storage.buckets','allowed_mime_types')
),
relations AS MATERIALIZED (
  SELECT c.*, n.nspname, format('%I.%I',n.nspname,c.relname) AS identity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','private','storage')
    AND c.relkind IN ('r','p','v','m','S','f')
),
function_rows AS MATERIALIZED (
  SELECT p.oid, p.oid::regprocedure::text AS identity,
    encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256,
    CASE WHEN p.prokind <> 'a'
      THEN encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') END AS definition_sha256,
    (to_jsonb(p)-ARRAY['oid','pronamespace','proowner','prolang','prorettype',
      'proargtypes','proallargtypes','protrftypes','provariadic','prosupport',
      'prosrc','probin','prosqlbody','proargdefaults','proacl','proconfig'])
    || jsonb_build_object(
      'namespace',n.nspname, 'owner',pg_get_userbyid(p.proowner), 'language',l.lanname,
      'return_type',format_type(p.prorettype,NULL),
      'argument_types',(SELECT coalesce(jsonb_agg(format_type(t,NULL) ORDER BY ord),'[]')
                        FROM unnest(p.proargtypes) WITH ORDINALITY a(t,ord)),
      'all_argument_types',CASE WHEN p.proallargtypes IS NOT NULL THEN
        (SELECT jsonb_agg(format_type(t,NULL) ORDER BY ord)
         FROM unnest(p.proallargtypes) WITH ORDINALITY a(t,ord)) END,
      'transform_types',CASE WHEN p.protrftypes IS NOT NULL THEN
        (SELECT jsonb_agg(format_type(t,NULL) ORDER BY ord)
         FROM unnest(p.protrftypes) WITH ORDINALITY a(t,ord)) END,
      'variadic_type',CASE WHEN p.provariadic<>0 THEN format_type(p.provariadic,NULL) END,
      'support_function',CASE WHEN p.prosupport<>0 THEN p.prosupport::oid::regprocedure::text END,
      'defaults_sha256',CASE WHEN p.proargdefaults IS NOT NULL THEN
        encode(sha256(convert_to(pg_get_expr(p.proargdefaults,0,false),'UTF8')),'hex') END,
      'binary_sha256',CASE WHEN p.probin IS NOT NULL THEN
        encode(sha256(convert_to(p.probin,'UTF8')),'hex') END,
      'has_sql_body',p.prosqlbody IS NOT NULL,
      'config_sha256',encode(sha256(convert_to(coalesce(to_jsonb(p.proconfig),'null')::text,'UTF8')),'hex'),
      'safe_config',(SELECT coalesce(jsonb_agg(v ORDER BY ord),'[]')
        FROM unnest(p.proconfig) WITH ORDINALITY a(v,ord)
        WHERE split_part(v,'=',1) IN ('search_path','row_security','lock_timeout','statement_timeout')),
      'acl_is_null',p.proacl IS NULL,
      'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'grantor',pg_get_userbyid(a.grantor),
        'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
        'privilege',a.privilege_type,'grantable',a.is_grantable)
        ORDER BY pg_get_userbyid(a.grantor) COLLATE "C",a.grantee=0,
          pg_get_userbyid(a.grantee) COLLATE "C",a.privilege_type COLLATE "C",a.is_grantable),'[]')
        FROM aclexplode(CASE WHEN cardinality(coalesce(p.proacl,acldefault('f',p.proowner)))>0 THEN coalesce(p.proacl,acldefault('f',p.proowner)) ELSE NULL::aclitem[] END) a)
    ) AS metadata
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_language l ON l.oid=p.prolang
  WHERE n.nspname IN ('public','private')
     OR p.oid IN (SELECT to_regprocedure(signature) FROM required_functions)
),
relation_rows AS MATERIALIZED (
  SELECT r.identity, jsonb_build_object(
    'kind',r.relkind,'owner',pg_get_userbyid(r.relowner),
    'rls',r.relrowsecurity,'force_rls',r.relforcerowsecurity,
    'persistence',r.relpersistence,'replica_identity',r.relreplident,
    'is_partition',r.relispartition,'options',r.reloptions,
    'partition_bound_sha256',CASE WHEN r.relpartbound IS NOT NULL THEN
      encode(sha256(convert_to(pg_get_expr(r.relpartbound,r.oid,false),'UTF8')),'hex') END,
    'parents',(SELECT coalesce(jsonb_agg(format('%I.%I',n.nspname,c.relname)
                ORDER BY i.inhseqno),'[]') FROM pg_inherits i
               JOIN pg_class c ON c.oid=i.inhparent JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE i.inhrelid=r.oid),
    'view_sha256',CASE WHEN r.relkind IN ('v','m') THEN
      encode(sha256(convert_to(pg_get_viewdef(r.oid,false),'UTF8')),'hex') END,
    'acl_is_null',r.relacl IS NULL,
    'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'grantor',pg_get_userbyid(a.grantor),
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY pg_get_userbyid(a.grantor) COLLATE "C",a.grantee=0,
        pg_get_userbyid(a.grantee) COLLATE "C",a.privilege_type COLLATE "C",a.is_grantable),'[]')
      FROM aclexplode(CASE WHEN cardinality(coalesce(r.relacl,acldefault(CASE WHEN r.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,r.relowner)))>0 THEN coalesce(r.relacl,acldefault(CASE WHEN r.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,r.relowner)) ELSE NULL::aclitem[] END) a)
  ) AS metadata FROM relations r
),
column_rows AS MATERIALIZED (
  SELECT r.identity||'.'||quote_ident(a.attname) AS identity, r.identity AS relation_name,
    a.attname AS column_name, jsonb_build_object(
      'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
      'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
      'storage',a.attstorage,'compression',a.attcompression,'is_local',a.attislocal,
      'collation',CASE WHEN a.attcollation<>0 THEN format('%I.%I',cn.nspname,co.collname) END,
      'default_sha256',CASE WHEN d.oid IS NOT NULL THEN
        encode(sha256(convert_to(pg_get_expr(d.adbin,d.adrelid,false),'UTF8')),'hex') END,
      'acl_is_null',a.attacl IS NULL,
      'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'grantor',pg_get_userbyid(x.grantor),
        'grantee',CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
        'privilege',x.privilege_type,'grantable',x.is_grantable)
        ORDER BY pg_get_userbyid(x.grantor) COLLATE "C",x.grantee=0,
          pg_get_userbyid(x.grantee) COLLATE "C",x.privilege_type COLLATE "C",x.is_grantable),'[]')
        FROM aclexplode(CASE WHEN cardinality(a.attacl)>0 THEN a.attacl ELSE NULL::aclitem[] END) x)
    ) AS metadata
  FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum
  LEFT JOIN pg_collation co ON co.oid=a.attcollation LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
),
policy_rows AS MATERIALIZED (
  SELECT r.identity||'.'||quote_ident(p.polname) AS identity, r.identity AS relation_name,
    jsonb_build_object('command',p.polcmd,'permissive',p.polpermissive,
      'roles',(SELECT jsonb_agg(CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END
        ORDER BY CASE WHEN role_oid=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END COLLATE "C")
        FROM unnest(p.polroles) a(role_oid)),
      'using_sha256',CASE WHEN p.polqual IS NOT NULL THEN
        encode(sha256(convert_to(pg_get_expr(p.polqual,p.polrelid,false),'UTF8')),'hex') END,
      'check_sha256',CASE WHEN p.polwithcheck IS NOT NULL THEN
        encode(sha256(convert_to(pg_get_expr(p.polwithcheck,p.polrelid,false),'UTF8')),'hex') END
    ) AS metadata
  FROM relations r JOIN pg_policy p ON p.polrelid=r.oid
),
trigger_rows AS MATERIALIZED (
  SELECT r.identity||'.'||quote_ident(t.tgname) AS identity, r.identity AS relation_name,
    jsonb_build_object('enabled',t.tgenabled,'internal',t.tgisinternal,
      'function',t.tgfoid::regprocedure::text,
      'function_body_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
      'definition_sha256',encode(sha256(convert_to(pg_get_triggerdef(t.oid,false),'UTF8')),'hex')) AS metadata
  FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid JOIN pg_proc p ON p.oid=t.tgfoid
),
enum_rows AS MATERIALIZED (
  SELECT format('%I.%I',n.nspname,t.typname) AS identity,
    jsonb_build_object('owner',pg_get_userbyid(t.typowner),
      'labels',(SELECT coalesce(jsonb_agg(e.enumlabel ORDER BY e.enumsortorder),'[]') FROM pg_enum e WHERE e.enumtypid=t.oid),
      'acl_is_null',t.typacl IS NULL,
      'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object(
        'grantor',pg_get_userbyid(a.grantor),
        'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
        'privilege',a.privilege_type,'grantable',a.is_grantable)
        ORDER BY pg_get_userbyid(a.grantor) COLLATE "C",a.grantee=0,
          pg_get_userbyid(a.grantee) COLLATE "C",a.privilege_type COLLATE "C",a.is_grantable),'[]')
        FROM aclexplode(CASE WHEN cardinality(coalesce(t.typacl,acldefault('T',t.typowner)))>0 THEN coalesce(t.typacl,acldefault('T',t.typowner)) ELSE NULL::aclitem[] END) a)) AS metadata
  FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
  WHERE t.typtype='e' AND n.nspname IN ('public','private')
),
metadata_entries(section,identity,metadata) AS MATERIALIZED (
  SELECT 'functions',identity,jsonb_build_object('body_sha256',body_sha256,
    'definition_sha256',definition_sha256,'catalog',metadata) FROM function_rows
  UNION ALL SELECT 'relations',identity,metadata FROM relation_rows
  UNION ALL SELECT 'columns',identity,metadata FROM column_rows
  UNION ALL SELECT 'policies',identity,metadata FROM policy_rows
  UNION ALL SELECT 'triggers',identity,metadata FROM trigger_rows
  UNION ALL SELECT 'enums',identity,metadata FROM enum_rows
  UNION ALL
  SELECT 'schemas',n.nspname,jsonb_build_object('owner',pg_get_userbyid(n.nspowner),
    'acl_is_null',n.nspacl IS NULL,
    'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
      'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      ORDER BY pg_get_userbyid(a.grantor) COLLATE "C",a.grantee=0,
        pg_get_userbyid(a.grantee) COLLATE "C",a.privilege_type COLLATE "C",a.is_grantable),'[]')
      FROM aclexplode(CASE WHEN cardinality(coalesce(n.nspacl,acldefault('n',n.nspowner)))>0 THEN coalesce(n.nspacl,acldefault('n',n.nspowner)) ELSE NULL::aclitem[] END) a))
  FROM pg_namespace n WHERE n.nspname IN ('public','private','storage','auth')
  UNION ALL
  SELECT 'default_acls',format('%I/%s/%s',pg_get_userbyid(d.defaclrole),
      coalesce(n.nspname,'<all schemas>'),d.defaclobjtype),
    jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'object_type',d.defaclobjtype,
      'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
        'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
        'privilege',a.privilege_type,'grantable',a.is_grantable)
        ORDER BY pg_get_userbyid(a.grantor) COLLATE "C",a.grantee=0,
          pg_get_userbyid(a.grantee) COLLATE "C",a.privilege_type COLLATE "C",a.is_grantable),'[]')
        FROM aclexplode(CASE WHEN cardinality(d.defaclacl)>0 THEN d.defaclacl ELSE NULL::aclitem[] END) a))
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
  WHERE d.defaclnamespace=0 OR n.nspname IN ('public','private','storage','auth')
  UNION ALL
  SELECT 'roles',r.rolname,jsonb_build_object('superuser',r.rolsuper,'inherit',r.rolinherit,
    'create_role',r.rolcreaterole,'create_database',r.rolcreatedb,'login',r.rolcanlogin,
    'replication',r.rolreplication,'bypass_rls',r.rolbypassrls)
  FROM pg_roles r
  UNION ALL
  SELECT 'role_memberships',format('%I/%I/%I',pg_get_userbyid(m.roleid),
      pg_get_userbyid(m.member),pg_get_userbyid(m.grantor)),
    jsonb_build_object('role',pg_get_userbyid(m.roleid),'member',pg_get_userbyid(m.member),
      'grantor',pg_get_userbyid(m.grantor),'admin',m.admin_option,
      'inherit',m.inherit_option,'set',m.set_option)
  FROM pg_auth_members m
  UNION ALL
  SELECT 'constraints',r.identity||'.'||quote_ident(c.conname),
    jsonb_build_object('type',c.contype,'validated',c.convalidated,'deferrable',c.condeferrable,
      'deferred',c.condeferred,'no_inherit',c.connoinherit,
      'definition_sha256',encode(sha256(convert_to(pg_get_constraintdef(c.oid,false),'UTF8')),'hex'))
  FROM relations r JOIN pg_constraint c ON c.conrelid=r.oid
  UNION ALL
  SELECT 'indexes',format('%I.%I',n.nspname,c.relname),
    jsonb_build_object('table',r.identity,'unique',i.indisunique,'primary',i.indisprimary,
      'exclusion',i.indisexclusion,'valid',i.indisvalid,'ready',i.indisready,
      'live',i.indislive,'nulls_not_distinct',i.indnullsnotdistinct,
      'definition_sha256',encode(sha256(convert_to(pg_get_indexdef(i.indexrelid,0,false),'UTF8')),'hex'))
  FROM relations r JOIN pg_index i ON i.indrelid=r.oid
  JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  UNION ALL
  SELECT 'rules',r.identity||'.'||quote_ident(w.rulename),
    jsonb_build_object('enabled',w.ev_enabled,
      'definition_sha256',encode(sha256(convert_to(pg_get_ruledef(w.oid,false),'UTF8')),'hex'))
  FROM relations r JOIN pg_rewrite w ON w.ev_class=r.oid
  UNION ALL
  SELECT 'sequences',r.identity,jsonb_build_object('type',format_type(s.seqtypid,NULL),
    'start',s.seqstart::text,'increment',s.seqincrement::text,'minimum',s.seqmin::text,
    'maximum',s.seqmax::text,'cache',s.seqcache::text,'cycle',s.seqcycle)
  FROM relations r JOIN pg_sequence s ON s.seqrelid=r.oid
  UNION ALL
  SELECT 'event_triggers',e.evtname,jsonb_build_object('event',e.evtevent,'enabled',e.evtenabled,
    'owner',pg_get_userbyid(e.evtowner),'tags',e.evttags,'function',e.evtfoid::regprocedure::text,
    'function_body_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'))
  FROM pg_event_trigger e JOIN pg_proc p ON p.oid=e.evtfoid
),
section_names(section) AS (VALUES ('functions'),('relations'),('columns'),('policies'),
  ('triggers'),('enums'),('schemas'),('default_acls'),('roles'),('role_memberships'),
  ('constraints'),('indexes'),('rules'),('sequences'),('event_triggers')),
section_digests AS MATERIALIZED (
  SELECT s.section,count(m.identity)::text AS entries,
    encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('identity',m.identity,'metadata',m.metadata)
      ORDER BY m.identity COLLATE "C") FILTER(WHERE m.identity IS NOT NULL),'[]')::text,'UTF8')),'hex') AS sha256
  FROM section_names s LEFT JOIN metadata_entries m USING(section) GROUP BY s.section
),
data_specs AS (
  SELECT name,NULL::text[] AS fields,'protected'::text AS category FROM protected_names
  UNION ALL SELECT name,fields,'authority' FROM authority_names
),
data_readiness AS MATERIALIZED (
  SELECT s.*,r.oid,r.nspname,r.relname,
    CASE WHEN r.oid IS NULL THEN 'missing_relation'
      WHEN r.relkind NOT IN ('r','p') THEN 'unexpected_relation_kind'
      WHEN NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user),false)
        THEN 'full_row_visibility_unproven'
      WHEN NOT has_table_privilege(r.oid,'SELECT') THEN 'select_privilege_missing'
      WHEN s.fields IS NOT NULL AND EXISTS(SELECT 1 FROM unnest(s.fields) AS required_field(field_name)
        WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=r.oid
          AND a.attname=required_field.field_name AND a.attnum>0 AND NOT a.attisdropped)) THEN 'missing_required_columns'
      ELSE 'ready' END AS status
  FROM data_specs s LEFT JOIN relations r ON r.identity=s.name
),
data_xml AS MATERIALIZED (
  SELECT d.*,CASE WHEN d.status='ready' THEN query_to_xml(format(
    'SELECT count(*)::text AS row_count, encode(sha256(convert_to(coalesce(string_agg(h,'''' ORDER BY h COLLATE "C"),''''),''UTF8'')),''hex'') AS content_sha256 FROM (SELECT encode(sha256(convert_to((%s)::text,''UTF8'')),''hex'') AS h FROM %I.%I AS t) AS rows_to_hash',
    CASE WHEN d.fields IS NULL THEN 'to_jsonb(t)' ELSE
      'jsonb_build_object('||(SELECT string_agg(format('%L,to_jsonb(t)->%L',f,f),',' ORDER BY ord)
        FROM unnest(d.fields) WITH ORDINALITY a(f,ord))||')' END,
    d.nspname,d.relname),false,false,'') END AS document
  FROM data_readiness d
),
data_pins AS MATERIALIZED (
  SELECT name,category,fields,status,
    CASE WHEN status='ready' THEN (xpath('/table/row/row_count/text()',document))[1]::text END AS row_count,
    CASE WHEN status='ready' THEN (xpath('/table/row/content_sha256/text()',document))[1]::text END AS content_sha256
  FROM data_xml
),
bucket_readiness AS MATERIALIZED (
  SELECT CASE WHEN to_regclass('storage.buckets') IS NULL THEN 'missing_relation'
    WHEN NOT EXISTS(SELECT 1 FROM relations WHERE identity='storage.buckets' AND relkind IN ('r','p'))
      THEN 'unexpected_relation_kind'
    WHEN EXISTS(SELECT 1 FROM required_columns q WHERE q.relation_name='storage.buckets'
      AND NOT EXISTS(SELECT 1 FROM column_rows c WHERE c.relation_name=q.relation_name AND c.column_name=q.column_name))
      THEN 'missing_required_columns'
    WHEN NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user),false)
      THEN 'full_row_visibility_unproven'
    WHEN NOT has_table_privilege(to_regclass('storage.buckets'),'SELECT') THEN 'select_privilege_missing'
    ELSE 'ready' END AS status
),
bucket_xml AS MATERIALIZED (
  SELECT status,CASE WHEN status='ready' THEN query_to_xml(
    'SELECT coalesce(jsonb_agg(jsonb_build_object(''id'',id,''name'',name,''public'',public,''file_size_limit'',file_size_limit,''allowed_mime_types'',allowed_mime_types) ORDER BY id COLLATE "C"),''[]''::jsonb)::text AS payload FROM storage.buckets',
    false,false,'') END AS document FROM bucket_readiness
),
bucket_data AS MATERIALIZED (
  SELECT b.status,x.payload::jsonb AS metadata FROM bucket_xml b
  LEFT JOIN LATERAL XMLTABLE('/table/row' PASSING b.document COLUMNS payload text PATH 'payload') x ON true
),
missing AS MATERIALIZED (
  SELECT 'schema'::text AS kind,s.name AS identity FROM (VALUES('public'),('private'),('storage'),('auth')) s(name)
    WHERE to_regnamespace(s.name) IS NULL
  UNION ALL SELECT 'function',signature FROM required_functions WHERE to_regprocedure(signature) IS NULL
  UNION ALL SELECT 'relation',q.name FROM (SELECT name FROM protected_names UNION SELECT name FROM authority_surface_names) q
    WHERE NOT EXISTS(SELECT 1 FROM relations r WHERE r.identity=q.name)
  UNION ALL SELECT 'relation_kind',s.name||' (expected table, observed '||r.relkind::text||')'
    FROM authority_surface_names s JOIN relations r ON r.identity=s.name WHERE r.relkind NOT IN ('r','p')
  UNION ALL SELECT 'column',q.relation_name||'.'||q.column_name FROM required_columns q
    WHERE NOT EXISTS(SELECT 1 FROM column_rows c WHERE c.relation_name=q.relation_name AND c.column_name=q.column_name)
  UNION ALL SELECT 'role',q.name FROM (VALUES('anon'),('authenticated'),('service_role'),('postgres')) q(name)
    WHERE NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=q.name)
  UNION ALL SELECT 'enum','public.user_role' WHERE NOT EXISTS(SELECT 1 FROM enum_rows WHERE identity='public.user_role')
),
co_presence AS MATERIALIZED (
  SELECT 'relation'::text AS kind,identity FROM relations
    WHERE nspname='private' AND left(relname,3)='co_'
  UNION ALL SELECT 'function',identity FROM function_rows
    WHERE starts_with(identity,'private.co_')
      OR starts_with(identity,'public.pilot_co_')
      OR starts_with(identity,'public.pilot_reconcile_co_')
  UNION ALL SELECT 'enum_value','public.user_role.co_admin' FROM enum_rows
    WHERE identity='public.user_role' AND metadata->'labels' ? 'co_admin'
  UNION ALL SELECT 'bucket','co-evidence' FROM bucket_data,
    LATERAL jsonb_array_elements(coalesce(metadata,'[]')) b WHERE b->>'id'='co-evidence'
  UNION ALL SELECT 'fixture_relation',identity FROM relations
    WHERE identity IN ('public.pilot_fixture_marker','public.co_fixture_identity_v1')
)
SELECT jsonb_build_object(
  'inventory_version','co-staging-readonly-v1',
  'intended_project_ref','mqfpupsuthghubkeiuey',
  'project_identity','controller must verify connector project; not asserted by this SQL',
  'inspected_source_commit','d269efabc7c68335e139b6aa950aaa4c0e868ec4',
  'transaction_timestamp_utc',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'statement_timestamp_utc',to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'observation',jsonb_build_object('database',current_database(),'database_owner',
    (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()),
    'current_user',current_user,'session_user',session_user,
    'server_version_num',current_setting('server_version_num'),
    'transaction_isolation',current_setting('transaction_isolation'),
    'transaction_read_only',current_setting('transaction_read_only'),
    'canonicalization','PostgreSQL17 JSONB text, UTC/ISO, C sort; data hash = SHA256(concatenated sorted fixed-width hex SHA256 of each projected JSONB row), preserving duplicates; catalog hash = SHA256(sorted JSONB entries)'),
  'complete',NOT EXISTS(SELECT 1 FROM missing)
    AND (SELECT count(*)=44 AND bool_and(status='ready'
      AND coalesce(row_count~'^[0-9]+$',false)
      AND coalesce(content_sha256~'^[a-f0-9]{64}$',false)) FROM data_pins)
    AND (SELECT status='ready' AND coalesce(jsonb_typeof(metadata)='array',false) FROM bucket_data)
    AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999,
  'missing_required',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY kind COLLATE "C",identity COLLATE "C"),'[]') FROM missing m),
  'pre_co_state_matches',NOT EXISTS(SELECT 1 FROM co_presence),
  'pre_co_expected_absence',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY kind COLLATE "C",identity COLLATE "C"),'[]') FROM co_presence c),
  'section_digests',(SELECT jsonb_object_agg(section,jsonb_build_object('entries',entries,'sha256',sha256)) FROM section_digests),
  'function_pins',(SELECT jsonb_agg(jsonb_build_object('signature',q.signature,
      'present',f.oid IS NOT NULL,'body_sha256',f.body_sha256,'definition_sha256',f.definition_sha256,
      'metadata_sha256',CASE WHEN f.oid IS NOT NULL THEN encode(sha256(convert_to(f.metadata::text,'UTF8')),'hex') END,
      'owner',f.metadata->'owner','language',f.metadata->'language','definer',f.metadata->'prosecdef',
      'volatility',f.metadata->'provolatile','safe_config',f.metadata->'safe_config','execute_acl',f.metadata->'acl')
      ORDER BY q.signature COLLATE "C") FROM required_functions q LEFT JOIN function_rows f ON f.oid=to_regprocedure(q.signature)),
  'authority_relations',(SELECT jsonb_agg(jsonb_build_object('name',s.name,
      'present',r.identity IS NOT NULL,'owner',r.metadata->'owner','kind',r.metadata->'kind',
      'rls',r.metadata->'rls','force_rls',r.metadata->'force_rls',
      'metadata_sha256',CASE WHEN r.identity IS NOT NULL THEN encode(sha256(convert_to(r.metadata::text,'UTF8')),'hex') END,
      'table_privileges',(SELECT jsonb_object_agg(role.rolname,
        (SELECT coalesce(jsonb_agg(privilege ORDER BY privilege COLLATE "C"),'[]')
         FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) op(privilege)
         WHERE has_table_privilege(role.oid,to_regclass(s.name),privilege)))
        FROM pg_roles role WHERE role.rolname IN ('anon','authenticated','service_role')),
      'policy_entries',(SELECT count(*)::text FROM policy_rows p WHERE p.relation_name=s.name),
      'policy_sha256',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('identity',p.identity,'metadata',p.metadata)
        ORDER BY p.identity COLLATE "C"),'[]')::text,'UTF8')),'hex') FROM policy_rows p WHERE p.relation_name=s.name))
      ORDER BY s.name COLLATE "C") FROM authority_surface_names s LEFT JOIN relation_rows r ON r.identity=s.name),
  'column_pins',(SELECT jsonb_agg(jsonb_build_object('relation',q.relation_name,'column',q.column_name,
      'present',c.identity IS NOT NULL,'metadata',c.metadata) ORDER BY q.relation_name COLLATE "C",q.column_name COLLATE "C")
      FROM required_columns q LEFT JOIN column_rows c ON c.relation_name=q.relation_name AND c.column_name=q.column_name),
  'user_role',(SELECT metadata FROM enum_rows WHERE identity='public.user_role'),
  'storage_buckets',(SELECT jsonb_build_object('status',status,'metadata',metadata,
      'sha256',CASE WHEN status='ready' THEN encode(sha256(convert_to(metadata::text,'UTF8')),'hex') END) FROM bucket_data),
  'data_pins',(SELECT jsonb_agg(to_jsonb(d) ORDER BY category COLLATE "C",name COLLATE "C") FROM data_pins d),
  'not_proven',jsonb_build_array('connector project identity','branch and migration receipts',
    'Edge deployed source/config/runtime','Storage provider bytes/version/replacement semantics',
    'Data API exposed-schema configuration and role-specific behavior','sequence current values','final candidate or deployment readiness')
) AS co_staging_inventory;
ROLLBACK;
