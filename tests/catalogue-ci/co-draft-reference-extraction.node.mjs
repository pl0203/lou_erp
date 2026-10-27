// Source-only checks; PostgreSQL contract remains authored, not executed.
import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const root=new URL('../../',import.meta.url);
const file=new URL('supabase/catalogue/v1/02-co-draft-reference-extraction.sql',root);
test('bounded SJ/return draft extractor exists',()=>assert.ok(existsSync(file)));
test('pure closed grammar retains OLD and structured constraints',()=>{
 const sql=readFileSync(file,'utf8');
 for(const token of ['IMMUTABLE SECURITY INVOKER',"ARRAY['OLD','NEW']",'source-stage08','source-stage04-pre-evidence','UNSUPPORTED_LEGACY_PROFILE','candidate_batch_ids','bound_delivery_revision_id','headId','draftId','posted_return_head_id','UNKNOWN_OPERATION','CATALOGUE_CO_DRAFT_ACL_DRIFT']) assert.ok(sql.includes(token),token);
 assert.doesNotMatch(sql,/CREATE (?:TABLE|TRIGGER|POLICY)|GRANT EXECUTE|tracking_ready/);
 const body=sql.split('AS $fn$')[1].split('$fn$;')[0].replace(/--[^\n]*/g,'').replace(/'(?:[^']|'')*'/g,"''");
 assert.doesNotMatch(body,/\b(?:INSERT|UPDATE|DELETE|LOCK|EXECUTE|gen_random_uuid)\b/i);
 assert.doesNotMatch(body,/\b(?:FROM|JOIN)\s+(?:private|public)\./i);
});

test('all six producer composition stages remain pinned', () => {
  const pins = {'supabase/migrations/20261009110001_co_foundation.sql': '23e1bba8ace0458918eb3f9b892c619851aee024eb4a53f008955c11160c0e9d', 'supabase/migrations/20261009110002_co_orders_deliveries.sql': 'd26610d5ffed5325369f21ed038078ed43a5c7b0c4834a8ed677fccf0d48cbaf', 'supabase/migrations/20261009110003_co_monthly_fifo.sql': 'b1388b07992fd3b2aeb4a844c3da326920b6981a6d970cb0413695bb9d175bb1', 'supabase/migrations/20261009110004_co_returns_corrections.sql': 'fe53057104ec61eb45f77701fac1ae8200a696abecee9a4fbc7403fd11d8f639', 'supabase/migrations/20261009110007_co_access.sql': '613579bcc348c7dadf77910beedd08ed88d88cad1a08f5d24b9870578c060fa6', 'supabase/migrations/20261009110008_co_evidence.sql': '2f012c59a546c183b006f3e9055f33f0886829dda3b164891a50050e3c527bb4'};
  for (const [path, digest] of Object.entries(pins)) assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'), digest, path);
});

test('runtime contract is exact and has declared refusal cases',()=>{
 const sql=readFileSync(new URL('tests/database/catalogue/co-draft-reference-extraction.sql',root),'utf8');
 for(const token of ['CATALOGUE_CO_DRAFT_MISSING_FUNCTION','actual IS DISTINCT FROM expected','exact positive','OLD removals','correction head revision tuple','explicit historical omission profile','refusal case','replaced evidence retained','consumed return head']) assert.ok(sql.includes(token),token);
});
