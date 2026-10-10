import { useMemo } from 'react'
import { useAuth } from './AuthContext'
import { createTransactionSender } from './orderTransactions'
import type { TransactionSender, TransactionResult } from './orderTransactions'
import type { ActivePromotion } from './promotions'
import { supabase } from './supabase'
import { isPOConflict } from './poConflict'
import { PRICE_TIERS, isValidPrice } from './catalogPricing'
export type PromotionPrices = { harga_pokok: number | null; luar_kota: number | null; dalam_kota: number | null; depo_bangunan: number | null }
export type PromotionCreate = PromotionPrices & { id: string; product_id: string; opening_quantity: number; is_active: boolean }
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
function ready(send: TransactionSender) {
  if (send.hasUnresolved?.()) throw new Error('Hasil penyimpanan sebelumnya belum terkonfirmasi. Pulihkan hasil sebelum mengubah promosi atau mengunggah gambar lagi.')
}
function prices(value: PromotionPrices) {
  if (!PRICE_TIERS.every(tier => value[tier] === null || typeof value[tier] === 'number' && isValidPrice(value[tier]!))) throw new Error('Harga promosi harus kosong, nol, atau positif dengan maksimal 2 angka desimal.')
}
export function validatePromotionReceipt(result: TransactionResult, _operation?: string, payload?: unknown): boolean {
  const expected = payload && typeof payload === 'object' ? payload as { id?: unknown; promotion_id?: unknown } : null
  const target = expected?.promotion_id ?? expected?.id
  return uuid(result.id) && Number.isSafeInteger(result.stock_version) && result.stock_version! >= 1 && (target === undefined || result.id === target)
}
export function usePromotionTransactionSender(scope = 'promotion-admin'): TransactionSender {
  const { user } = useAuth()
  return useMemo(() => createTransactionSender({ rpcName: 'pilot_promotion_transaction_v1', recoveryRpcName: 'pilot_reconcile_promotion_v1', validateResult: validatePromotionReceipt,
    ...(user?.id ? { storage: () => window.localStorage, storageKey: `pilot-request:${user.id}:${scope}` } : {}),
  }), [user?.id, scope])
}
export async function uploadPromotionImage(file: File, actorId: string, promotionId: string): Promise<string> {
  const extension = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }[file.type]
  if (!uuid(actorId) || !uuid(promotionId)) throw new Error('Identitas promosi atau pengguna tidak valid.')
  if (!extension || file.size <= 0 || file.size > 5 * 1024 * 1024) throw new Error('Gunakan gambar PNG, JPG, atau WebP maksimal 5 MiB.')
  const path = `promotions/${actorId}/${promotionId}/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage.from('promotion-images').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error(error.message)
  return path
}
class PromotionConflictError extends Error {
  readonly code = 'PT409'
  constructor() { super('Promosi berubah. Muat ulang dan periksa stok, harga, dan gambar terbaru sebelum menyimpan kembali.'); this.name = 'PromotionConflictError' }
}
async function sendPromotion(send: TransactionSender, operation: string, payload: unknown) {
  try { return await send(operation, payload) }
  catch (error) { if (isPOConflict(error)) throw new PromotionConflictError(); throw error }
}
export async function createPromotion(input: PromotionCreate, image: File, actorId: string, send: TransactionSender) {
  ready(send); prices(input)
  if (!uuid(input.id) || !uuid(input.product_id) || !Number.isSafeInteger(input.opening_quantity) || input.opening_quantity < 0 || typeof input.is_active !== 'boolean') throw new Error('Pilih produk dan isi stok awal berupa bilangan bulat nol atau positif.')
  if (!image) throw new Error('Gambar promosi wajib diunggah.')
  const image_path = await uploadPromotionImage(image, actorId, input.id)
  return sendPromotion(send, 'create_promotion', { ...input, image_path })
}
export async function editPromotion(current: ActivePromotion, input: PromotionPrices, image: File | null, actorId: string, send: TransactionSender) {
  ready(send); prices(input)
  const image_path = image ? await uploadPromotionImage(image, actorId, current.id) : current.image_path
  if (!image_path) throw new Error('Gambar promosi wajib diunggah.')
  return sendPromotion(send, 'edit_promotion', { promotion_id: current.id, expected_stock_version: current.stock_version, ...input, image_path })
}
export async function adjustPromotionStock(current: ActivePromotion, quantityDelta: number, reason: string, send: TransactionSender) {
  ready(send)
  if (!Number.isSafeInteger(quantityDelta) || quantityDelta === 0) throw new Error('Perubahan stok harus bilangan bulat dan bukan nol.')
  if (!reason.trim()) throw new Error('Isi alasan penyesuaian stok.')
  return sendPromotion(send, 'adjust_stock', { promotion_id: current.id, expected_stock_version: current.stock_version, quantity_delta: quantityDelta, reason: reason.trim() })
}
export async function setPromotionActive(current: ActivePromotion, isActive: boolean, send: TransactionSender) {
  ready(send)
  return sendPromotion(send, 'set_active', { promotion_id: current.id, expected_stock_version: current.stock_version, is_active: isActive })
}
