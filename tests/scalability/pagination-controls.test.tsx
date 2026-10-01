import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import PaginationControls from '../../src/components/PaginationControls'
afterEach(cleanup)
test('shows the exact represented range and disables navigation while pending', () => {
  const change = vi.fn()
  const { rerender } = render(<PaginationControls page={2} total={101} pageSize={10} pending={false} onPageChange={change} />)
  expect(screen.getByText(/11–20 dari 101/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Berikutnya' }))
  expect(change).toHaveBeenCalledWith(3)
  rerender(<PaginationControls page={2} total={101} pageSize={10} pending onPageChange={change} />)
  expect(screen.getByRole('button', { name: 'Berikutnya' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: 'Sebelumnya' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('status').textContent).toMatch(/Memperbarui/)
})
test('zero and final pages expose only valid navigation', () => {
  const change = vi.fn()
  const { rerender } = render(<PaginationControls page={1} total={0} pageSize={10} pending={false} onPageChange={change} />)
  expect(screen.getByText(/0–0 dari 0/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Berikutnya' }).hasAttribute('disabled')).toBe(true)
  rerender(<PaginationControls page={11} total={101} pageSize={10} pending={false} onPageChange={change} />)
  expect(screen.getByText(/101–101 dari 101/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Sebelumnya' }))
  expect(change).toHaveBeenCalledWith(10)
})
