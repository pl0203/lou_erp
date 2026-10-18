import type { Metric, PlanState, TargetActor, TargetPlan } from './contracts'
export const TARGET_LABELS: Record<Metric, string> = { po_order_value: 'Nilai PO masuk', po_delivery_value: 'Nilai PO dikirim', co_sale_value: 'Nilai CO terjual' }
export const TARGET_DEFINITIONS: Record<Metric, string> = {
  po_order_value: 'Nilai PO menurut tanggal order dan status yang memenuhi syarat. Bukan nilai pengiriman.',
  po_delivery_value: 'Nilai PO yang dikirim menurut tanggal surat jalan yang tidak dibatalkan.',
  co_sale_value: 'Nilai CO terjual menurut bulan laporan penjualan terposting. Pengiriman CO belum berarti penjualan.',
}
export const PLAN_LABELS: Record<PlanState, string> = { draft: 'Draf belum diajukan', submitted: 'Menunggu Sales Head atau Direktur', returned: 'Dikembalikan untuk diperbaiki', published: 'Diterbitkan', superseded: 'Digantikan revisi baru' }
export function canPropose(actor: TargetActor): boolean { return actor.active && actor.role === 'sales_manager' }
/** Visibility hint only. The command API independently checks current hierarchy/authority. */
export function canApprove(actor: TargetActor, plan: TargetPlan): boolean { return actor.active && ['sales_head', 'executive'].includes(actor.role) && actor.id !== plan.proposedBy && plan.state === 'submitted' }
export function canEditPlan(actor: TargetActor, plan: TargetPlan): boolean { return canPropose(actor) && actor.id === plan.proposedBy && ['draft', 'returned'].includes(plan.state) }
