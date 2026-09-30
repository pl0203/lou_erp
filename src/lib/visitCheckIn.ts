import { supabase } from './supabase'
import type { TransactionSender } from './orderTransactions'
export type VisitInput = { schedule_id: string; photo_blob: Blob; lat: number | null; lng: number | null }
/** Persist only random upload ID + image digest, never image bytes or coordinates. */
export function createVisitCheckIn(send: TransactionSender, storage: () => Storage, storageKey: string) {
  return async (payload: VisitInput) => {
    const { lat, lng, photo_blob: photo, schedule_id: schedule } = payload
    if ((lat === null) !== (lng === null) || (lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) || (lng !== null && (!Number.isFinite(lng) || Math.abs(lng) > 180))) throw new Error('Lokasi tidak valid. Ambil lokasi kembali.')
    if (photo.type !== 'image/webp' || photo.size <= 0 || photo.size > 3145728) throw new Error('Foto harus WebP dan maksimal 3 MiB.')
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await photo.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
    const raw = storage().getItem(storageKey)
    const previous = raw ? JSON.parse(raw) : null
    if (previous && (typeof previous.id !== 'string' || !/^[a-f0-9-]{36}$/.test(previous.id) || typeof previous.hash !== 'string')) throw new Error('Metadata pemulihan foto tidak valid. Hubungi administrator.')
    if (send.hasUnresolved() && (!previous || previous.hash !== hash)) throw new Error('Pulihkan check-in sebelumnya sebelum mengganti foto.')
    const upload = previous?.hash === hash ? previous : { id: crypto.randomUUID(), hash }
    storage().setItem(storageKey, JSON.stringify(upload))
    const path = `visits/${schedule}/${upload.id}.webp`
    // A lost response or 409 is NOT proof of successful upload. The authoritative
    // finalize RPC below must independently find the exact actor-owned object.
    try { await supabase.storage.from('visits').upload(path, photo, { contentType: 'image/webp', upsert: false }) } catch { /* finalize validates actual server state */ }
    const result = await send('finalize_visit', { schedule_id: schedule, storage_path: path, lat, lng })
    storage().removeItem(storageKey)
    return result
  }
}
