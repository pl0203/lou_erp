import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import TransactionRecovery from '../src/components/TransactionRecovery'
import type { TransactionSender } from '../src/lib/orderTransactions'

afterEach(cleanup)
test('ordinary save exposes neutral progress, then recovery only after an unresolved outcome', () => {
 let active = true
 const send = Object.assign(vi.fn(), { isInFlight: () => active, hasUnresolved: () => true, reconcile: vi.fn(), acknowledgeRecovered: vi.fn() }) as TransactionSender
 const view = render(<TransactionRecovery send={send} onCommitted={vi.fn()} />)
 expect(screen.getByRole('status').textContent).toMatch(/Menyimpan/)
 expect(screen.queryByRole('alert')).toBeNull()
 expect(screen.queryByRole('button', { name: /Pulihkan/ })).toBeNull()
 active = false
 view.rerender(<TransactionRecovery send={send} onCommitted={vi.fn()} />)
 expect(screen.getByRole('alert').textContent).toMatch(/belum terkonfirmasi/)
 expect(screen.getByRole('button', { name: /Pulihkan/ })).toBeTruthy()
})
