// Offline category-specific evidence builder/parser. No connection or execution.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildCustomerCategoryMigrationGuards } from '../tests/customer-category-migration-guards.mjs';
import { buildCustomerCategoryLegacyGuards, LEGACY_CATEGORY_MARKERS } from '../tests/customer-category-legacy-guards.mjs';
import { buildCustomerCategoryPreapplyMetadataSql, evaluateCustomerCategoryPreapply, assertCustomerCategoryPreflightSource } from './customer-category-preapply.mjs';
export const CATEGORY_GUARD_MARKERS=Object.freeze([
 'CUSTOMER_CATEGORY_MIGRATION_EXISTING_ROWS_VERIFIED',
 ...Array.from({length:7},(_,i)=>`CUSTOMER_CATEGORY_MIGRATION_DRIFT_REJECTED_${i+1}`),
]);
export { LEGACY_CATEGORY_MARKERS };
export const CATEGORY_INVARIANT_MARKERS=Object.freeze([
 'CUSTOMER_CATEGORIES_VALUES_VERIFIED','CUSTOMER_CATEGORIES_ROLES_VERIFIED',
 'CUSTOMER_CATEGORIES_PRICING_HISTORY_VERIFIED','CUSTOMER_CATEGORIES_VERIFIED',
]);
export function assertCategorySqlMarkers(output,expected) {
 const lines=String(output).split(/\r?\n/);
 if(lines.some(line=>/^(?:psql:(?:[^\n]*?:)?\s*)?(?:ERROR|FATAL|PANIC):/i.test(line)))throw new Error('Category SQL error in evidence');
 const markers=lines.map(line=>line.replace(/^(?:psql:[^\n]*?:\s*)?NOTICE:\s+(?:00000:\s+)?/,'')).filter(line=>/^CUSTOMER_CATEGOR(?:Y_|IES_)/.test(line));
 if(markers.length!==expected.length||expected.some(marker=>markers.filter(line=>line===marker).length!==1))throw new Error('Exact category SQL markers required once each');
 return [...expected];
}
export function assertCategoryPreapplyEvidence(output,expectedLayout) {
 if(!['canonical-fixture-v1','known-legacy-v1'].includes(expectedLayout))throw new Error('Explicit supported category layout required');
 const lines=String(output).split(/\r?\n/).filter(line=>line.trim()!=='');
 if(lines.length!==1)throw new Error('One complete pre-apply metadata result required');
 let metadata;
 try { metadata=JSON.parse(lines[0]); } catch { throw new Error('One complete pre-apply metadata result required'); }
 const verdict=evaluateCustomerCategoryPreapply(metadata);
 if(!verdict.accepted || !verdict.complete || verdict.layout!==expectedLayout)throw new Error('Category pre-apply metadata contract refused');
 return verdict;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 if(process.argv.length!==3)throw new Error('One fixed category CI action required');
 const action=process.argv[2];
 if(action==='build-guards'||action==='build-legacy-guards'||action==='build-preapply') {
  const source=readFileSync('supabase/migrations/202610020001_customer_categories.sql','utf8');
  assertCustomerCategoryPreflightSource(source);
  mkdirSync('scale-results',{recursive:true});
  if(action==='build-guards')writeFileSync('scale-results/customer-category-guards.sql',buildCustomerCategoryMigrationGuards(source));
  else if(action==='build-legacy-guards')writeFileSync('scale-results/customer-category-legacy-guards.sql',buildCustomerCategoryLegacyGuards(source));
  else writeFileSync('scale-results/customer-category-preapply.sql',buildCustomerCategoryPreapplyMetadataSql());
 } else if(action==='verify-preapply-canonical'||action==='verify-preapply-legacy') {
  const kind=action==='verify-preapply-canonical'?'canonical':'legacy';
  const source=readFileSync('supabase/migrations/202610020001_customer_categories.sql','utf8');
  assertCustomerCategoryPreflightSource(source);
  const verdict=assertCategoryPreapplyEvidence(readFileSync(`scale-results/customer-category-preapply-${kind}.log`,'utf8'),kind==='canonical'?'canonical-fixture-v1':'known-legacy-v1');
  console.log(`CUSTOMER_CATEGORY_PREAPPLY_${kind.toUpperCase()}_VERIFIED layout=${verdict.layout}`);
 } else if(action==='verify-guards'||action==='verify-invariants'||action==='verify-legacy-guards') {
  const kind=action==='verify-guards'?'guards':action==='verify-legacy-guards'?'legacy-guards':'invariants';
  assertCategorySqlMarkers(readFileSync(`scale-results/customer-category-${kind}.log`,'utf8'),kind==='guards'?CATEGORY_GUARD_MARKERS:kind==='legacy-guards'?LEGACY_CATEGORY_MARKERS:CATEGORY_INVARIANT_MARKERS);
 } else throw new Error('Unknown category CI action');
}
