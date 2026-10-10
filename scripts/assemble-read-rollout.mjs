/**
 * Source assembly only. No CLI, SQL execution, publication or database access.
 * beforeSql/afterSql must be fixed strings from separately reviewed caller code;
 * they are not user input. This structural validator is not a SQL authorizer or
 * a replacement for the caller's fingerprint, metadata and rollback guards.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const APPROVED_READ_MIGRATIONS = Object.freeze([
  ['202610010001_scalable_order_reads.sql', '071ea9280adf79b6ba5c0eb405e7b66706332f2ce2e183a9983a312a025614da', true],
  ['202610010002_scalable_report_reads.sql', '8a7ee2a24e942f1c0d82d48b3d122ad88b25d48a090a88cc35f194d3882f03e4', true],
  ['202610010004_scalable_order_lookup_index.sql', '9e8d5afba857af858e743b33a516eaf3f240738f7c2a5ea544f8fdc171ba0088', false],
  ['202610010007_read_policy_plans.sql', '7cf626f169b52d993c00724c0ba34ba96438c85e03adea8b2c646a2e1a51c9dd', true],
  ['202610010008_customer_delivery_aggregation.sql', '9bc0fb3cf69cf0273025bfbe7d2af36cce55bde5460cfee3d27fdbeaa2ef868a', true],
  ['202610010009_sales_page_enrichment.sql', '40f8109d8e5bb449c2ea65ac54843915d80ac3ecd0431aeff33fb661427edd74', true],
].map(([filename, sha256, outerTransaction]) => Object.freeze({ path: `supabase/migrations/${filename}`, sha256, outerTransaction })))

const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex')
const transactionHeads = new Set(['BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'ABORT', 'END', 'SAVEPOINT', 'RELEASE', 'PREPARE'])

/** Small lexer, not a PostgreSQL parser: quoted bodies/comments never become
 * outer statement boundaries. Unterminated constructs and psql commands fail
 * closed. Offsets refer to the original string; no formatting is performed. */
function statements(source, allowTrailing = false) {
  if (typeof source !== 'string' || source.includes('\0') || source.charCodeAt(0) === 0xfeff) throw new Error('Invalid SQL source')
  const result = []
  let tokens = [], index = 0, depth = 0
  while (index < source.length) {
    const start = index, char = source[index]
    if (/\s/.test(char)) { index++; continue }
    if (source.startsWith('--', index)) {
      const end = source.indexOf('\n', index + 2)
      index = end < 0 ? source.length : end + 1
      continue
    }
    if (source.startsWith('/*', index)) {
      let nesting = 1
      index += 2
      while (index < source.length && nesting) {
        if (source.startsWith('/*', index)) { nesting++; index += 2 }
        else if (source.startsWith('*/', index)) { nesting--; index += 2 }
        else index++
      }
      if (nesting) throw new Error('Unterminated SQL comment')
      continue
    }
    if (char === '\\') throw new Error('psql commands and unquoted backslashes are forbidden')
    if (char === "'" || char === '"') {
      const escaped = char === "'" && /[eE]/.test(source[index - 1] ?? '') && !/[A-Za-z_0-9$]/.test(source[index - 2] ?? '')
      let value = '', closed = false
      index++
      while (index < source.length) {
        if (escaped && source[index] === '\\') {
          if (index + 1 >= source.length) break
          value += source[index + 1]
          index += 2
        } else if (source[index] === char) {
          if (source[index + 1] === char) { value += char; index += 2 }
          else { index++; closed = true; break }
        } else value += source[index++]
      }
      if (!closed) throw new Error('Unterminated SQL quotation')
      tokens.push({ kind: char === "'" ? 'literal' : 'identifier', value, start, end: index })
      continue
    }
    const dollar = char === '$' && source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0]
    if (dollar) {
      const end = source.indexOf(dollar, index + dollar.length)
      if (end < 0) throw new Error('Unterminated dollar-quoted SQL')
      tokens.push({ kind: 'body', value: source.slice(index + dollar.length, end), start, end: end + dollar.length })
      index = end + dollar.length
      continue
    }
    const word = source.slice(index).match(/^[A-Za-z_][A-Za-z_0-9$]*/)?.[0]
    if (word) {
      index += word.length
      tokens.push({ kind: 'word', value: word.toUpperCase(), start, end: index })
      continue
    }
    if (char === '(') depth++
    if (char === ')' && --depth < 0) throw new Error('Unbalanced SQL parentheses')
    if (char === ';') {
      if (depth) throw new Error('Statement delimiter inside unclosed parentheses')
      if (tokens.length) result.push({ tokens, start: tokens[0].start, end: index + 1 })
      tokens = []
    } else tokens.push({ kind: 'symbol', value: char, start, end: index + 1 })
    index++
  }
  if (depth) throw new Error('Unbalanced SQL parentheses')
  if (tokens.length) {
    if (!allowTrailing) throw new Error('SQL statements must end with a semicolon')
    result.push({ tokens, start: tokens[0].start, end: source.length })
  }
  return result
}

function head(statement) {
  return statement.tokens[0]?.kind === 'word' ? statement.tokens[0].value : ''
}
function assertNoTransactions(parsed) {
  if (parsed.some(statement => transactionHeads.has(head(statement)))) throw new Error('Unexpected transaction wrapper or transaction escape')
}

function transactionLine(source, statement, keyword) {
  if (statement.tokens.length !== 1 || head(statement) !== keyword) throw new Error(`Expected a single outer ${keyword};`)
  const start = source.lastIndexOf('\n', statement.start - 1) + 1
  const nextLine = source.indexOf('\n', statement.end)
  const end = nextLine < 0 ? source.length : nextLine + 1
  if (!new RegExp(`^[\\t ]*${keyword};[\\t ]*(?:\\r?\\n)?$`).test(source.slice(start, end))) throw new Error('Outer transaction commands must occupy their own lines')
  return { start, end }
}

export function stripMigrationTransaction(source, outerTransaction) {
  if (typeof outerTransaction !== 'boolean') throw new Error('Explicit transaction structure required')
  const parsed = statements(source)
  if (!parsed.length) throw new Error('Empty migration')
  if (!outerTransaction) { assertNoTransactions(parsed); return source }
  if (parsed.length < 3) throw new Error('Migration body missing')
  const first = transactionLine(source, parsed[0], 'BEGIN')
  const last = transactionLine(source, parsed.at(-1), 'COMMIT')
  assertNoTransactions(parsed.slice(1, -1))
  return source.slice(0, first.start) + source.slice(first.end, last.start) + source.slice(last.end)
}

function assertProceduralBody(body) {
  for (const statement of statements(body, true)) {
    const tokens = statement.tokens
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      if (token.kind !== 'word') continue
      // ON COMMIT DROP/DELETE/PRESERVE is table lifetime, not transaction control.
      const tableLifetime = token.value === 'COMMIT' && tokens[i - 1]?.value === 'ON'
        && ['DROP', 'DELETE', 'PRESERVE'].includes(tokens[i + 1]?.value)
      if (!tableLifetime && ['COMMIT', 'ROLLBACK', 'ABORT', 'SAVEPOINT', 'RELEASE'].includes(token.value)) throw new Error('Transaction control inside caller guard')
      if (['START', 'PREPARE'].includes(token.value) && tokens[i + 1]?.value === 'TRANSACTION') throw new Error('Transaction escape inside caller guard')
    }
  }
}

function assertGuard(source) {
  const parsed = statements(source)
  if (!parsed.length) throw new Error('A fixed reviewed guard is required before and after the source bodies')
  assertNoTransactions(parsed)
  for (const statement of parsed) {
    const first = head(statement), words = statement.tokens.filter(token => token.kind === 'word').map(token => token.value)
    if (['COPY', 'DISCARD', 'LOAD', 'VACUUM', 'RESET'].includes(first)) throw new Error('Unsafe caller guard command')
    if (first === 'SET' && words[1] !== 'LOCAL') throw new Error('Only transaction-local caller settings are allowed')
    if ((first === 'ALTER' && words[1] === 'SYSTEM') || (['CREATE', 'DROP'].includes(first) && words[1] === 'DATABASE')) throw new Error('Unsafe caller guard command')
    if (first === 'DO' || (first === 'CREATE' && words.some(word => ['FUNCTION', 'PROCEDURE'].includes(word)))) {
      for (const token of statement.tokens) if (['body', 'literal'].includes(token.kind)) assertProceduralBody(token.value)
    }
  }
}

function approvedSources(sources) {
  if (!Array.isArray(sources) || sources.length !== APPROVED_READ_MIGRATIONS.length) throw new Error('Exactly the six approved migration sources are required')
  const entries = new Map()
  for (const source of sources) {
    if (!source || typeof source.path !== 'string' || typeof source.sql !== 'string'
      || !APPROVED_READ_MIGRATIONS.some(entry => entry.path === source.path) || entries.has(source.path)) throw new Error('Missing, duplicate or unapproved migration path')
    entries.set(source.path, source.sql)
  }
  return APPROVED_READ_MIGRATIONS.map(entry => {
    const sql = entries.get(entry.path)
    if (typeof sql !== 'string' || sha256(sql) !== entry.sha256) throw new Error(`Pinned source hash mismatch: ${entry.path}`)
    return { ...entry, sql, body: stripMigrationTransaction(sql, entry.outerTransaction) }
  })
}

/** Reads only fixed approved paths. A missing/drifted source fails closed; there
 * is no search, alternate source, supplied hash override or rejected migration. */
export function loadApprovedReadSources(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || !repositoryRoot) throw new Error('Explicit repository root required')
  const sources = APPROVED_READ_MIGRATIONS.map(entry => ({
    path: entry.path, sql: readFileSync(resolve(repositoryRoot, entry.path), 'utf8'),
  }))
  approvedSources(sources)
  return sources
}

export function assembleReadRollout({ sources, beforeSql, afterSql }) {
  const approved = approvedSources(sources)
  assertGuard(beforeSql)
  assertGuard(afterSql)
  let sql = `BEGIN;\n${beforeSql}\n`
  const fragments = []
  for (const source of approved) {
    const startByte = Buffer.byteLength(sql, 'utf8')
    sql += source.body
    const endByte = Buffer.byteLength(sql, 'utf8')
    fragments.push({ path: source.path, sourceSha256: source.sha256, bodySha256: sha256(source.body), startByte, endByte })
    sql += '\n'
  }
  sql += `${afterSql}\nCOMMIT;\n`
  const parsed = statements(sql)
  transactionLine(sql, parsed[0], 'BEGIN')
  transactionLine(sql, parsed.at(-1), 'COMMIT')
  assertNoTransactions(parsed.slice(1, -1))
  const bytes = Buffer.from(sql, 'utf8')
  for (let i = 0; i < fragments.length; i++) {
    if (!bytes.subarray(fragments[i].startByte, fragments[i].endByte).equals(Buffer.from(approved[i].body, 'utf8'))) throw new Error('Assembled source body identity failed')
  }
  return {
    sql,
    manifest: approved.map(({ path, sha256 }) => ({ path, sha256 })),
    fragments,
    checks: {
      sourceCount: approved.length, sourceBodiesPreserved: true, outerTransactions: { begin: 1, commit: 1 },
      beforeSha256: sha256(beforeSql), afterSha256: sha256(afterSql), assembledSha256: sha256(sql),
    },
  }
}

/** Rebuilds from reviewed inputs and rejects any modified assembled bytes. */
export function assertAssembledReadRollout({ sql, ...inputs }) {
  const expected = assembleReadRollout(inputs)
  if (sql !== expected.sql) throw new Error('Assembled SQL differs from the approved sources and reviewed guards')
  return expected.checks
}
