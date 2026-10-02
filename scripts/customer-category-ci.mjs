// Offline category-specific evidence builder/parser. No connection or execution.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildCustomerCategoryMigrationGuards } from '../tests/customer-category-migration-guards.mjs';
export const CATEGORY_GUARD_MARKERS=Object.freeze([
 'CUSTOMER_CATEGORY_MIGRATION_EXISTING_ROWS_VERIFIED',
 ...Array.from({length:6},(_,i)=>`CUSTOMER_CATEGORY_MIGRATION_DRIFT_REJECTED_${i+1}`),
]);
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
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 if(process.argv.length!==3)throw new Error('One fixed category CI action required');
 const action=process.argv[2];
 if(action==='build-guards') {
  const source=readFileSync('supabase/migrations/202610020001_customer_categories.sql','utf8');
  mkdirSync('scale-results',{recursive:true});
  writeFileSync('scale-results/customer-category-guards.sql',buildCustomerCategoryMigrationGuards(source));
 } else if(action==='verify-guards'||action==='verify-invariants') {
  const kind=action==='verify-guards'?'guards':'invariants';
  assertCategorySqlMarkers(readFileSync(`scale-results/customer-category-${kind}.log`,'utf8'),kind==='guards'?CATEGORY_GUARD_MARKERS:CATEGORY_INVARIANT_MARKERS);
 } else throw new Error('Unknown category CI action');
}
