import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import BrandLogo from '../src/components/BrandLogo'
afterEach(cleanup)
test('the lockup uses the exact approved outlined option A asset without a runtime font request', () => {
 const svg = readFileSync('public/brand/padiwan-logo.svg', 'utf8')
 expect(createHash('sha256').update(svg).digest('hex')).toBe('d70b22924c44f0dcb7ef5ef0909fdcf34b129750bccf9af9c95315548f2242bb')
 const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
 expect(document.querySelectorAll('#wordmark path')).toHaveLength(7)
 expect(document.querySelectorAll('text, image, script, use')).toHaveLength(0)
 expect(svg).not.toMatch(/@font-face|https?:\/\/(?!www\.w3\.org\/2000\/svg)/)
})
test('the new lockup retains its approved aspect ratio and existing sidebar sizing', () => {
 render(<BrandLogo />)
 const logo = screen.getByRole('img', { name: 'Padiwan' })
 expect(logo.getAttribute('width')).toBe('474'); expect(logo.getAttribute('height')).toBe('104')
 expect(logo.classList.contains('h-auto')).toBe(true)
 expect(readFileSync('src/components/navigation.css', 'utf8')).toMatch(/\.navigation-toolbar \.navigation-wordmark\s*\{\s*width:\s*154px/)
})
test('the symbol-only asset, colors and intrinsic dimensions remain untouched', () => {
 expect(createHash('sha256').update(readFileSync('public/brand/padiwan-mark.svg')).digest('hex')).toBe('7c0afbfb856b058aeb2c7b40878ec0f2566bd4f6bf6295d1171da1848be09397')
 render(<BrandLogo variant="mark" />)
 const logo = screen.getByRole('img', { name: 'Padiwan' })
 expect(logo.getAttribute('width')).toBe('512'); expect(logo.getAttribute('height')).toBe('512')
})
test('the Plus Jakarta Sans open-font license accompanies the outlined wordmark', () => {
 const path = 'public/brand/PlusJakartaSans-OFL.txt'
 expect(existsSync(path)).toBe(true)
 const license = readFileSync(path, 'utf8')
 expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1')
 expect(license).toContain('Plus Jakarta Sans')
})
