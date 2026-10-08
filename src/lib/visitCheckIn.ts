import { MAX_VISIT_PHOTO_BYTES } from './visitPhoto'
import { supabase } from './supabase'
import type { TransactionSender } from './orderTransactions'
export type VisitInput = { schedule_id: string; expected_schedule_version: number; customer_id: string; scheduled_date: string; notes: string; photo_blob: Blob; lat: number | null; lng: number | null }
/** Persist only random upload ID + image digest, never image bytes or coordinates. */
export function createVisitCheckIn(send: TransactionSender, storage: () => Storage, storageKey: string) {
  return async (payload: VisitInput) => {
    const { lat, lng, photo_blob: photo, schedule_id: schedule, expected_schedule_version, customer_id, scheduled_date, notes } = payload
    if (typeof notes !== 'string' || notes.length > 2000) throw new Error('Catatan kunjungan maksimal 2000 karakter.')
    if (!Number.isSafeInteger(expected_schedule_version) || expected_schedule_version < 1 || !customer_id || !/^\d{4}-\d{2}-\d{2}$/.test(scheduled_date)) throw new Error('Jadwal berubah. Muat ulang dan ambil foto baru.')
    if ((lat === null) !== (lng === null) || (lat !== null && (!Number.isFinite(lat) || Math.abs(lat) > 90)) || (lng !== null && (!Number.isFinite(lng) || Math.abs(lng) > 180))) throw new Error('Lokasi tidak valid. Ambil lokasi kembali.')
    if (!['image/webp', 'image/jpeg'].includes(photo.type) || photo.size <= 0 || photo.size > MAX_VISIT_PHOTO_BYTES) throw new Error('Foto harus WebP atau JPEG dan maksimal 3 MiB.')
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await photo.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
    const bindingHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([schedule, expected_schedule_version, customer_id, scheduled_date, notes, lat, lng, hash])))), byte => byte.toString(16).padStart(2, '0')).join('')
    const raw = storage().getItem(storageKey)
    const previous = raw ? JSON.parse(raw) : null
    if (previous && (typeof previous.id !== 'string' || !/^[a-f0-9-]{36}$/.test(previous.id) || typeof previous.hash !== 'string')) throw new Error('Metadata pemulihan foto tidak valid. Hubungi administrator.')
    if (send.hasUnresolved() && (!previous || previous.bindingHash !== bindingHash)) throw new Error('Pulihkan check-in sebelumnya sebelum mengganti foto.')
    const upload = previous?.bindingHash === bindingHash ? previous : { id: crypto.randomUUID(), hash, bindingHash }
    storage().setItem(storageKey, JSON.stringify(upload))
    const extension = photo.type === 'image/jpeg' ? 'jpg' : 'webp'
    const path = `visits/${schedule}/${upload.id}.${extension}`
    // A lost response or 409 is NOT proof of successful upload. The authoritative
    // finalize RPC below must independently find the exact actor-owned object.
    try { await supabase.storage.from('visits').upload(path, photo, { contentType: photo.type, upsert: false }) } catch { /* finalize validates actual server state */ }
    try {
      const result = await send('finalize_visit', { schedule_id: schedule, expected_schedule_version, customer_id, scheduled_date, storage_path: path, lat, lng, notes })
      storage().removeItem(storageKey)
      return result
    } catch (error) {
      if (error instanceof Error && error.message.includes('VISIT_SCHEDULE_CHANGED')) storage().removeItem(storageKey)
      throw error
    }
  }
}
