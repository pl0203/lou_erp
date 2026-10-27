type SearchColumn = 'name' | 'city' | 'sku'

/** Case-insensitive literal substring search, including LIKE/regex metacharacters.
 * PostgreSQL's ***= director treats everything after it as plain text. Quoting
 * and escaping protect the surrounding PostgREST logical-filter grammar.
 * https://www.postgresql.org/docs/17/functions-matching.html#POSIX-METASYNTAX
 * https://docs.postgrest.org/en/stable/references/api/url_grammar.html#reserved-characters
 */
export function literalSearchFilter(columns: readonly SearchColumn[], value: string): string {
  if (columns.length === 0 || columns.some(column => !['name', 'city', 'sku'].includes(column))) throw new Error('Unsupported search column')
  const quoted = `"***=${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return columns.map(column => `${column}.imatch.${quoted}`).join(',')
}
