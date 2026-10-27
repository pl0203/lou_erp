import { useState } from 'react'
import type { TransactionSender, TransactionResult } from '../lib/orderTransactions'
import { Button } from './ui/Button'
import { Notice } from './ui/Feedback'

export default function TransactionRecovery({ send, onCommitted, onAbandoned }: { send: TransactionSender; onCommitted: (result: TransactionResult, operation?: string) => void; onAbandoned?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<'info' | 'success' | 'warning'>('warning')
  if (send.isInFlight?.()) return <Notice tone="info" className="m-4" title="Menyimpan… Tunggu hasil penyimpanan." />
  if (!send.hasUnresolved() && !message) return null
  async function reconcile() {
    if (!window.confirm('Periksa hasil permintaan sebelumnya? Jika sudah tersimpan, hasilnya akan ditampilkan. Jika belum tersimpan, permintaan lama akan dibatalkan secara aman sebelum Anda membuat permintaan baru.')) return
    setBusy(true)
    try {
      const result = await send.reconcile()
      if (result.state === 'committed' && typeof result.result?.id === 'string' && result.result.id.trim()) {
        onCommitted(result.result, result.operation)
        send.acknowledgeRecovered()
        setMessage(`Operasi sebelumnya sudah tersimpan. Periksa hasil tersimpan (referensi ${result.result.id}).`)
        setTone('success')
      } else if (result.state === 'abandoned') {
        // The original sender owns terminal recovery; this only refreshes its UI owner.
        onAbandoned?.()
        setMessage('Permintaan lama telah dibatalkan. Anda dapat menyimpan kembali.')
        setTone('info')
      } else {
        setMessage('Hasil belum dapat dipastikan. Jangan buat permintaan baru.')
        setTone('warning')
      }
    } catch (error) { setMessage((error as Error).message); setTone('warning') }
    finally { setBusy(false) }
  }
  return <Notice tone={send.hasUnresolved() ? 'warning' : tone} className="m-4"
    title={message || 'Hasil penyimpanan sebelumnya belum terkonfirmasi. Coba lagi dengan data yang sama atau pulihkan hasilnya.'}
    actions={<>
      {send.hasUnresolved() && <Button variant="secondary" pending={busy} onClick={reconcile}>{busy ? 'Memeriksa...' : 'Pulihkan hasil penyimpanan'}</Button>}
      {!send.hasUnresolved() && message && <Button variant="secondary" onClick={() => setMessage('')}>Tutup</Button>}
    </>} />
}
