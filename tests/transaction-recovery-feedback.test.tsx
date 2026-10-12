import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import TransactionRecovery from '../src/components/TransactionRecovery'
import type { TransactionSender } from '../src/lib/orderTransactions'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
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


test('unknown write does not show success or acknowledge the original request', async () => {
 vi.spyOn(window, 'confirm').mockReturnValue(true)
 const committed = vi.fn(), acknowledge = vi.fn(), abandoned = vi.fn()
 const send = Object.assign(vi.fn(), { hasUnresolved: () => true, reconcile: async () => ({ state: 'unknown' as const }), acknowledgeRecovered: acknowledge }) as TransactionSender
 render(<TransactionRecovery send={send} onCommitted={committed} onAbandoned={abandoned} />)
 fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }))
 await screen.findByText('Hasil belum dapat dipastikan. Jangan buat permintaan baru.')
 expect(screen.queryByText(/sudah tersimpan|telah dibatalkan/)).toBeNull()
 expect(screen.getByRole('alert').classList.contains('ui-notice--warning')).toBe(true)
 expect(screen.queryByRole('status')).toBeNull()
 expect(committed).not.toHaveBeenCalled()
 expect(abandoned).not.toHaveBeenCalled()
 expect(acknowledge).not.toHaveBeenCalled()
 expect(send).not.toHaveBeenCalled()
})

test('pending recovery invokes the original sender only and cannot start a second recovery', async () => {
 vi.spyOn(window, 'confirm').mockReturnValue(true)
 let finish!: (value: { state: 'committed'; result: { id: string }; operation: string }) => void
 let unresolved = true, originalReconciliations = 0
 const originalAcknowledgement = vi.fn(() => { unresolved = false })
 const original = Object.assign(vi.fn(), { hasUnresolved: () => unresolved, reconcile: () => { originalReconciliations += 1; return new Promise(resolve => { finish = resolve }) }, acknowledgeRecovered: originalAcknowledgement }) as TransactionSender
 const replacement = Object.assign(vi.fn(), { hasUnresolved: () => true, reconcile: vi.fn(), acknowledgeRecovered: vi.fn() }) as TransactionSender
 const accepted = vi.fn(), abandoned = vi.fn()
 const view = render(<TransactionRecovery send={original} onCommitted={accepted} onAbandoned={abandoned} />)
 const recover = screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }) as HTMLButtonElement
 expect(recover.classList.contains('ui-action')).toBe(true)
 expect(recover.type).toBe('button')
 fireEvent.click(recover)
 expect(recover.disabled).toBe(true)
 expect(recover.getAttribute('aria-busy')).toBe('true')
 fireEvent.click(recover)
 view.rerender(<TransactionRecovery send={replacement} onCommitted={accepted} onAbandoned={abandoned} />)
 finish({ state: 'committed', result: { id: 'recovered' }, operation: 'create_po' })
 await waitFor(() => expect(accepted).toHaveBeenCalledWith({ id: 'recovered' }, 'create_po'))
 expect(originalAcknowledgement).toHaveBeenCalledOnce()
 expect(abandoned).not.toHaveBeenCalled()
 expect(originalReconciliations).toBe(1)
 expect(replacement.reconcile).not.toHaveBeenCalled()
 expect(replacement.acknowledgeRecovered).not.toHaveBeenCalled()
 expect(original).not.toHaveBeenCalled()
 expect(replacement).not.toHaveBeenCalled()
})


test('confirmed abandonment releases recovery without claiming a committed write', async () => {
 vi.spyOn(window, 'confirm').mockReturnValue(true)
 let unresolved = true
 const accepted = vi.fn(), acknowledge = vi.fn(), abandoned = vi.fn()
 const send = Object.assign(vi.fn(), { hasUnresolved: () => unresolved, reconcile: async () => { unresolved = false; return { state: 'abandoned' as const } }, acknowledgeRecovered: acknowledge }) as TransactionSender
 render(<TransactionRecovery send={send} onCommitted={accepted} onAbandoned={abandoned} />)
 fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }))
 await screen.findByText('Permintaan lama telah dibatalkan. Anda dapat menyimpan kembali.')
 expect(screen.getByRole('status').classList.contains('ui-notice--info')).toBe(true)
 expect(abandoned).toHaveBeenCalledOnce()
 expect(screen.queryByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeNull()
 expect(accepted).not.toHaveBeenCalled()
 expect(acknowledge).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: 'Tutup' }))
 expect(screen.queryByRole('status')).toBeNull()
})

test('malformed committed receipt stays uncertain and cannot acknowledge recovery', async () => {
 vi.spyOn(window, 'confirm').mockReturnValue(true)
 const accepted = vi.fn(), acknowledge = vi.fn()
 const send = Object.assign(vi.fn(), { hasUnresolved: () => true, reconcile: async () => ({ state: 'committed' as const }), acknowledgeRecovered: acknowledge }) as TransactionSender
 render(<TransactionRecovery send={send} onCommitted={accepted} />)
 fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }))
 await screen.findByText('Hasil belum dapat dipastikan. Jangan buat permintaan baru.')
 expect(screen.queryByText(/sudah tersimpan|telah dibatalkan/)).toBeNull()
 expect(accepted).not.toHaveBeenCalled()
 expect(acknowledge).not.toHaveBeenCalled()
})


test('pending abandonment notifies only the original owner after an authoritative result', async () => {
 vi.spyOn(window, 'confirm').mockReturnValue(true)
 let finish!: (value: { state: 'abandoned' }) => void
 const originalAbandoned = vi.fn(), replacementAbandoned = vi.fn(), accepted = vi.fn()
 const original = Object.assign(vi.fn(), { hasUnresolved: () => true, reconcile: vi.fn(() => new Promise(resolve => { finish = resolve })), acknowledgeRecovered: vi.fn() }) as TransactionSender
 const replacement = Object.assign(vi.fn(), { hasUnresolved: () => true, reconcile: vi.fn(), acknowledgeRecovered: vi.fn() }) as TransactionSender
 const view = render(<TransactionRecovery send={original} onCommitted={accepted} onAbandoned={originalAbandoned} />)
 const recover = screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }) as HTMLButtonElement
 fireEvent.click(recover); fireEvent.click(recover)
 expect(original.reconcile).toHaveBeenCalledOnce()
 expect(originalAbandoned).not.toHaveBeenCalled()
 expect(recover.disabled).toBe(true)
 view.rerender(<TransactionRecovery send={replacement} onCommitted={accepted} onAbandoned={replacementAbandoned} />)
 finish({ state: 'abandoned' })
 await waitFor(() => expect(originalAbandoned).toHaveBeenCalledOnce())
 expect(replacementAbandoned).not.toHaveBeenCalled()
 expect(replacement.reconcile).not.toHaveBeenCalled()
 expect(accepted).not.toHaveBeenCalled()
 expect(original.acknowledgeRecovered).not.toHaveBeenCalled()
 expect(replacement.acknowledgeRecovered).not.toHaveBeenCalled()
})

test('a failed reconciliation never notifies an abandoned outcome', async () => {
 vi.spyOn(window, 'confirm').mockReturnValue(true)
 const abandoned = vi.fn()
 const send = Object.assign(vi.fn(), { hasUnresolved: () => true, reconcile: vi.fn().mockRejectedValue(new Error('Temporary recovery failure')), acknowledgeRecovered: vi.fn() }) as TransactionSender
 render(<TransactionRecovery send={send} onCommitted={vi.fn()} onAbandoned={abandoned} />)
 fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }))
 await screen.findByText('Temporary recovery failure')
 expect(abandoned).not.toHaveBeenCalled()
 expect(send.acknowledgeRecovered).not.toHaveBeenCalled()
 expect((screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' }) as HTMLButtonElement).disabled).toBe(false)
})
