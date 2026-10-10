import { useState } from 'react'
import type { TransactionSender, TransactionResult } from '../lib/orderTransactions'

export default function TransactionRecovery({ send, onCommitted }: { send: TransactionSender; onCommitted: (result: TransactionResult, operation?: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  if (!send.hasUnresolved() && !message) return null
  async function reconcile() {
    if (!window.confirm('Periksa hasil permintaan sebelumnya? Jika sudah tersimpan, hasilnya akan ditampilkan. Jika belum tersimpan, permintaan lama akan dibatalkan secara aman sebelum Anda membuat permintaan baru.')) return
    setBusy(true)
    try {
      const result = await send.reconcile()
      if (result.state === 'committed' && result.result) {
        onCommitted(result.result, result.operation)
        send.acknowledgeRecovered()
      }
      setMessage(result.state === 'committed'
        ? `Operasi sebelumnya sudah tersimpan. Periksa hasil tersimpan (referensi ${result.result?.id}).`
        : 'Permintaan lama telah dibatalkan. Anda dapat menyimpan kembali.')
    } catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }
  return <div role="alert" className="m-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
    <p>{message || 'Hasil penyimpanan sebelumnya belum terkonfirmasi. Coba lagi dengan data yang sama atau pulihkan hasilnya.'}</p>
    {send.hasUnresolved() && <button disabled={busy} onClick={reconcile} className="mt-2 font-medium underline">{busy ? 'Memeriksa...' : 'Pulihkan hasil penyimpanan'}</button>}
    {!send.hasUnresolved() && message && <button onClick={() => setMessage('')} className="mt-2 underline">Tutup</button>}
  </div>
}
