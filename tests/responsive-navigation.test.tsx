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

test('Procurement navigation has one sidebar link set rather than duplicate scrolling strips', () => {
  render(<MemoryRouter><AthelNav /></MemoryRouter>)
  const nav = screen.getByRole('navigation', { name: 'Navigasi Procurement' })
  expect(screen.getAllByRole('link', { name: 'Dashboard' })).toHaveLength(1)
  expect(nav.classList.contains('navigation-links')).toBe(true)
  expect(screen.getByRole('button', { name: 'Minimalkan menu' })).toBeTruthy()
})

test('pagination can wrap inside narrow detail cards and retains both page actions', () => {
  render(<PaginationControls page={22} total={99999} pageSize={20} pending={false} onPageChange={vi.fn()} />)
  const nav = screen.getByRole('navigation', { name: 'Halaman hasil' })
  expect(nav.classList.contains('flex-wrap')).toBe(true)
  expect(nav.classList.contains('min-w-0')).toBe(true)
  expect(screen.getByRole('button', { name: 'Sebelumnya' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Berikutnya' })).toBeTruthy()
})
