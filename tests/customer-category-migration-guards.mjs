// Pure SQL builder for an explicitly authorized disposable harness. No connection,
// filesystem access, CLI, hosted target or execution capability.
// Deliberately category-specific, not a SQL parser. Only the current migration's
// top-level statement sequence is supported; comments and quoted content cannot
// disguise another statement. Backslashes are unsupported even inside comments.
function assertSupportedMigration(source) {
  if (typeof source !== 'string' || /[\\\0]/.test(source)) throw new Error('Unsupported migration input or psql execution path')
  const statements = []
  let statement = ''
  let i = 0
  while (i < source.length) {
    if (source.startsWith('--', i)) {
      i += 2
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++
      statement += ' '
    } else if (source.startsWith('/*', i)) {
      let depth = 1
      i += 2
      while (depth && i < source.length) {
        if (source.startsWith('/*', i)) { depth++; i += 2 }
        else if (source.startsWith('*/', i)) { depth--; i += 2 }
        else i++
      }
      if (depth) throw new Error('Unclosed migration comment')
      statement += ' '
    } else if (source[i] === "'" || source[i] === '"') {
      const quote = source[i++]
      let closed = false
      while (i < source.length) {
        if (source[i++] !== quote) continue
        if (source[i] === quote) { i++; continue }
        closed = true
        break
      }
      if (!closed) throw new Error('Unclosed migration quote')
      statement += ' quoted '
    } else if (source[i] === '$') {
      const tag = source.slice(i).match(/^\$[a-z_]+\$/)?.[0]
      if (!['$preflight$', '$postflight$'].includes(tag) || !/^DO\s*$/i.test(statement.trim())) throw new Error('Unsupported migration dollar block')
      const end = source.indexOf(tag, i + tag.length)
      if (end < 0) throw new Error('Unclosed migration dollar block')
      statement += tag
      i = end + tag.length
    } else if (source[i] === ':') {
      if (!source.startsWith('::', i)) throw new Error('Unsupported psql variable interpolation')
      statement += '::'
      i += 2
    } else if (source[i] === ';') {
      statements.push(statement.trim().replace(/\s+/g, ' '))
      statement = ''
      i++
    } else statement += source[i++]
  }
  if (statement.trim()) throw new Error('Incomplete migration statement')
  const supported = [
    /^BEGIN$/i,
    /^SET LOCAL lock_timeout\s*=/i,
    /^SET LOCAL statement_timeout\s*=/i,
    /^SET LOCAL idle_in_transaction_session_timeout\s*=/i,
    /^SET LOCAL search_path\s*=/i,
    /^SET LOCAL row_security\s*=off$/i,
    /^LOCK TABLE public\.customers IN ACCESS EXCLUSIVE MODE$/i,
    /^DO \$preflight\$$/,
    ...['rows', 'relation', 'columns', 'policies', 'constraints'].map(name => new RegExp(`^CREATE TEMP TABLE customer_categories_${name}_before ON COMMIT DROP AS SELECT\\b`, 'i')),
    /^ALTER TABLE public\.customers ADD COLUMN customer_category text DEFAULT NULL, ADD CONSTRAINT customers_customer_category_check CHECK\s*\(/i,
    /^DO \$postflight\$$/,
    /^COMMIT$/i,
  ]
  if (statements.length !== supported.length || statements.some((text, index) => !supported[index].test(text))
    || source.match(/^BEGIN;$/gm)?.length !== 1 || source.match(/^COMMIT;$/gm)?.length !== 1 || !/\nCOMMIT;\s*$/.test(source)) {
    throw new Error('Only the bounded category migration statement sequence is supported')
  }
}

export function buildCustomerCategoryMigrationGuards(source) {
  assertSupportedMigration(source)
  const preflights = source.match(/DO \$preflight\$[\s\S]*?END \$preflight\$;/g)
  if (preflights?.length !== 1 || source.includes('$category_guard_source$')) throw new Error('Exact category preflight boundary required')
  const preflight = preflights[0]
  const body = source.replace(/^BEGIN;\n/m, '').replace(/\nCOMMIT;\s*$/, '')
  const guard = `SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL search_path='';
SET LOCAL row_security=off;
DO $disposable$ BEGIN
 IF current_database()<>'pilot_test' OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci')
 THEN RAISE EXCEPTION 'Disposable fixture required'; END IF;
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Disposable owner fixture required'; END IF;
END $disposable$;
LOCK TABLE public.customers IN ACCESS EXCLUSIVE MODE;`
  const cases = [
    ['ALTER TABLE public.customers ADD COLUMN customer_category text DEFAULT NULL;', 'Unexpected customer category schema; migration refused'],
    ['ALTER TABLE public.customers ADD COLUMN customer_category integer DEFAULT 1;', 'Unexpected customer category schema; migration refused'],
    ['ALTER TABLE public.customers ADD CONSTRAINT customers_customer_category_check CHECK (true);', 'Unexpected customer category schema; migration refused'],
    ['ALTER TABLE public.customers ADD COLUMN synthetic_unexpected_field text;', 'Unexpected customers column contract; migration refused'],
    ['ALTER TABLE public.customers DISABLE ROW LEVEL SECURITY;', 'Unexpected customers relation contract; migration refused'],
    ['ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;', 'Unexpected customers relation contract; migration refused'],
  ]
  const negative = cases.map(([mutation, expected], index) => `BEGIN;
${guard}
${mutation}
DO $negative$ BEGIN
 BEGIN
  EXECUTE $category_guard_source$${preflight}$category_guard_source$;
  RAISE EXCEPTION 'Category preflight accepted unexpected state';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'${expected}' THEN RAISE; END IF;
 END;
 RAISE NOTICE 'CUSTOMER_CATEGORY_MIGRATION_DRIFT_REJECTED_${index + 1}';
END $negative$;
ROLLBACK;`).join('\n\n')
  return `-- Generated from the exact candidate migration. Disposable synthetic-only.
-- Success proves old rows and ACL/RLS metadata through the actual postflight.
BEGIN;
${guard}
INSERT INTO public.customers(id,name,address,city,phone,email,pricing_tier,visit_frequency_days,last_visit_date,created_at)
 VALUES('95000000-0000-0000-0010-000000000001','Synthetic pre-migration category customer','Fictional baseline road','Synthetic baseline city','000-000','category-baseline@example.invalid','others',14,'2026-08-20','2026-08-01T00:00:00Z');
CREATE TEMP TABLE category_migration_guard_original ON COMMIT DROP AS
 SELECT to_jsonb(c) AS original_row FROM public.customers c WHERE c.id='95000000-0000-0000-0010-000000000001';
${body}
DO $success$ BEGIN
 IF (SELECT to_jsonb(c)-'customer_category' FROM public.customers c WHERE c.id='95000000-0000-0000-0010-000000000001')
 IS DISTINCT FROM (SELECT original_row FROM category_migration_guard_original)
 OR (SELECT customer_category FROM public.customers WHERE id='95000000-0000-0000-0010-000000000001') IS NOT NULL
 THEN RAISE EXCEPTION 'Additive migration changed existing legacy row'; END IF;
 RAISE NOTICE 'CUSTOMER_CATEGORY_MIGRATION_EXISTING_ROWS_VERIFIED';
END $success$;
ROLLBACK;

${negative}
`
}
