import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
it('uses only defined application brand tokens in target screens', () => {
  const theme = readFileSync('src/index.css', 'utf8'), tokens = new Set([...theme.matchAll(/--color-(brand-[a-z-]+):/g)].map(match => match[1]))
  const files = ['TargetAuditDetails', 'TargetWizard', 'TargetReview', 'TargetHistoryDetails', 'TargetPlanInbox']
  const unknown = files.flatMap(file => [...readFileSync(`src/components/sales/${file}.tsx`, 'utf8').matchAll(/\bbrand-[a-z-]+\b/g)].map(match => match[0]).filter(token => !tokens.has(token)).map(token => `${file}:${token}`))
  expect([...new Set(unknown)]).toEqual([])
})
