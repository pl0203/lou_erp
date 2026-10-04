import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'executive', full_name: 'Example Executive' }, signOut: vi.fn() }) }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: 100 }) }))
import AthelNav from '../src/components/AthelNav'
import PaginationControls from '../src/components/PaginationControls'
afterEach(cleanup)

test('Athel navigation keeps a shrinkable scrolling link strip through tablet widths', () => {
  render(<MemoryRouter><AthelNav /></MemoryRouter>)
  const links = screen.getAllByRole('link', { name: 'Dashboard' })
  const desktop = links[0].parentElement!
  const compact = links[1].parentElement!
  expect(desktop.classList.contains('lg:flex')).toBe(true)
  expect(compact.classList.contains('lg:hidden')).toBe(true)
  expect(compact.classList.contains('min-w-0')).toBe(true)
  expect(compact.classList.contains('overflow-x-auto')).toBe(true)
})

test('pagination can wrap inside narrow detail cards and retains both page actions', () => {
  render(<PaginationControls page={22} total={99999} pageSize={20} pending={false} onPageChange={vi.fn()} />)
  const nav = screen.getByRole('navigation', { name: 'Halaman hasil' })
  expect(nav.classList.contains('flex-wrap')).toBe(true)
  expect(nav.classList.contains('min-w-0')).toBe(true)
  expect(screen.getByRole('button', { name: 'Sebelumnya' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Berikutnya' })).toBeTruthy()
})
