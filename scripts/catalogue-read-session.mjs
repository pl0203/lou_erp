// Pure preparation only. This module cannot open a connection or publish evidence.
import assert from 'node:assert/strict';
import { parseReadJson } from './catalogue-read-json.mjs';
import { foundationTopLevelSql } from './catalogue-foundation.mjs';
import { catalogueCiIdentityGateSql } from './catalogue-ci-profile.mjs';
export const readSqlPaths=Object.freeze({foundation:'supabase/catalogue/v1/01-foundation.sql',candidate:'supabase/catalogue/v1/05-reads.sql',suite:'tests/database/catalogue/reads.sql'});
const outputPrefix="SELECT 'CATALOGUE_READ_SQL_OUTPUT:' || ";
const absent=`pg_catalog.to_regclass('private.catalog_identity_v1') IS NULL
 AND pg_catalog.to_regclass('private.catalog_cutover_v1') IS NULL
 AND pg_catalog.to_regprocedure('public.pilot_procurement_access_v2()') IS NULL
 AND pg_catalog.to_regprocedure('public.pilot_catalog_page_v1(text,text,text,text,integer,integer)') IS NULL
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid IN ('public.products'::regclass,'public.customers'::regclass) AND attnum>0 AND NOT attisdropped AND attname IN ('is_enabled','catalog_version'))
 AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id IN ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000102'))`;
const gate=(condition,label)=>`SELECT (${condition}) AS catalogue_read_gate\n\\gset\n\\if :catalogue_read_gate\n\\else\nSELECT 1/0 AS ${label};\n\\endif\n`;
export function buildCatalogueReadSession(identity,parts) {
 assert.deepEqual(Object.keys(parts).sort(),Object.keys(readSqlPaths).sort());
 for(const sql of Object.values(parts))foundationTopLevelSql(sql);
 assert.equal(parts.suite.split(outputPrefix).length,2,'Exactly one output SELECT required');
 const start=parts.suite.indexOf(outputPrefix),end=parts.suite.indexOf('::text;',start);
 assert.ok(start>=0&&end>start,'Exact frozen output boundary required');
 // Keep the actual SQL expression byte-for-byte; only its client presentation
 // changes. Output is retained until all later assertions and rollback pass.
 const suite=parts.suite.slice(0,start)+'SELECT '+parts.suite.slice(start+outputPrefix.length,end)+'::text AS catalogue_read_json\n\\gset\n'+parts.suite.slice(end+7);
 const same=`current_user='postgres' AND pg_catalog.pg_backend_pid()=:'catalogue_read_pid'::integer
 AND pg_catalog.txid_current()=:'catalogue_read_xid'::bigint
 AND (SELECT count(*)=1 AND bool_and(pid=pg_catalog.pg_backend_pid() AND xid=pg_catalog.txid_current()) FROM pg_temp.catalogue_read_session_v1)`;
 return `\\set ON_ERROR_STOP on
\\o /dev/null
${catalogueCiIdentityGateSql(identity)}${gate(absent,'catalogue_read_preexisting_refused')}BEGIN;
SET LOCAL search_path = '';
SET LOCAL standard_conforming_strings = on;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SELECT pg_catalog.pg_backend_pid() AS catalogue_read_pid,pg_catalog.txid_current() AS catalogue_read_xid
\\gset
CREATE TEMP TABLE catalogue_read_session_v1 ON COMMIT DROP AS SELECT pg_catalog.pg_backend_pid() AS pid,pg_catalog.txid_current() AS xid;
${parts.foundation}
${parts.candidate}
${gate(same,'catalogue_read_session_refused')}${suite}
${gate(same,'catalogue_read_session_refused')}ROLLBACK;
${catalogueCiIdentityGateSql(identity)}${gate(`${absent} AND pg_catalog.pg_backend_pid()=:'catalogue_read_pid'::integer AND pg_catalog.to_regclass('pg_temp.catalogue_read_session_v1') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema())`,'catalogue_read_rollback_refused')}\\echo CATALOGUE_READ_ROLLBACK_VERIFIED :catalogue_read_pid :catalogue_read_xid
\\echo CATALOGUE_READ_SQL_OUTPUT: :catalogue_read_json
\\o
`;
}
export function parseCatalogueReadOutput(output) {
 assert.equal(typeof output,'string');assert.ok(Buffer.byteLength(output)<=128*1024);
 assert.ok(output.endsWith('\n'));const lines=output.slice(0,-1).split('\n');assert.equal(lines.length,2);
 const marker=lines[0].match(/^CATALOGUE_READ_ROLLBACK_VERIFIED ([1-9][0-9]*) ([1-9][0-9]*)$/);assert.ok(marker);
 assert.ok(lines[1].startsWith('CATALOGUE_READ_SQL_OUTPUT: '));
 const raw=lines[1].slice('CATALOGUE_READ_SQL_OUTPUT: '.length);const {value,canonicalText:json}=parseReadJson(raw,{postgres:true});
 assert.equal(value?.format,'catalogue-read-sql-output-v1');
 // Parsing is not certification; callers must require successful process exit,
 // source/identity postflight, then real TypeScript decoder validation.
 return {backendPid:marker[1],transactionId:marker[2],json};
}
