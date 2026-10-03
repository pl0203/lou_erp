// Static literal check, not a SQL parser: generated values/behavior still need PostgreSQL.
// Deliberately invalid inputs are returned too; each caller must name its exact exceptions.
export function malformedFixtureUuids(source: string): { line: number; value: string }[] {
  const canonical = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
  return source.split('\n').flatMap((text, line) => {
    const candidates = new Map<number, string>()
    for (const pattern of [
      /(?<=['"])([a-z0-9]{8}-[a-z0-9-]*)(?=['"])/gi,
      /"(?:id|[a-zA-Z][a-zA-Z0-9_]*(?:_id|Id))"\s*:\s*"([^"]*)"/g,
      /'([^']*)'\s*::\s*uuid\b/gi,
    ]) {
      for (const match of text.matchAll(pattern)) {
        candidates.set(match.index! + match[0].indexOf(match[1]), match[1])
      }
    }
    return [...candidates].sort(([a], [b]) => a - b).flatMap(([index, value]) => {
      // The seed concatenates a canonical prefix with a padded suffix; it is not a complete literal.
      const seedPrefix = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-$/i.test(value)
        && /^'\s*\|\|\s*lpad\(/i.test(text.slice(index + value.length))
      return canonical.test(value) || seedPrefix ? [] : [{ line: line + 1, value }]
    })
  })
}
