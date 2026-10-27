import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('shows Padiwan in the browser tab', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
  const page = new DOMParser().parseFromString(html, 'text/html')
  expect(page.title).toBe('Padiwan')
})
