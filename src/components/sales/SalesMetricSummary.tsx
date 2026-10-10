import { useQuery } from '@tanstack/react-query'
import { COPagination, quantityText } from '../co/COShared'
import type { SalesMetricGroup, SalesMetricSummary as Summary, SalesMetricValues } from '../../lib/reads/contracts'
import { formatMoney } from '../../lib/reads/money'
import { salesMonthLabel, salesMonthOptions, useSalesMetrics } from '../../lib/reads/useSalesMetrics'
import { IncompleteReadError, readComplete } from '../../lib/reads/completeReads'
import { supabase } from '../../lib/supabase'

const INPUT = 'min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand-primary'
const BUTTON = `${INPUT} disabled:opacity-50`
function Values({value}: {value: SalesMetricValues}) {
  return <div className="grid min-w-0 gap-3 md:grid-cols-3">
    {([
      ['PO Order Value',value.po_order_value,'Jumlah PO',value.po_order_count],
      ['PO Delivered Revenue',value.po_delivered_revenue,'PO dengan pengiriman',value.po_delivered_order_count],
      ['CO Sold Revenue',value.co_sold_revenue,'CO dengan penjualan',value.co_sold_order_count],
    ] as const).map(([label,amount,countLabel,count])=><article key={label} className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 p-4">
      <h3 className="text-sm font-medium text-gray-700">{label}</h3>
      <p className="mt-2 text-lg font-semibold tabular-nums text-gray-900 [overflow-wrap:anywhere]">Rp {formatMoney(amount,'full')}</p>
      <p className="mt-1 text-xs text-gray-600 [overflow-wrap:anywhere]">{countLabel}: {quantityText(count)}</p>
    </article>)}
  </div>
}
export default function SalesMetricSummary({summary}: {summary: Summary}) {
  return <section aria-label="Ringkasan seluruh hasil" className="space-y-3">
    <h2 className="font-semibold text-gray-900">Ringkasan seluruh hasil</h2>
    <Values value={summary}/>
    <p className="text-sm text-gray-600 [overflow-wrap:anywhere]">Laporan CO (pelanggan/bulan): {quantityText(summary.co_report_event_count)}</p>
  </section>
}
async function fetchManagers(signal: AbortSignal) {
  const rows = await readComplete<{id:string;full_name:string}>(async (offset,limit) => {
    const {data,count,error} = await supabase.rpc('pilot_team_directory',{}, {count:'exact'}).select('id,full_name').eq('role','sales_manager').eq('is_active',true).order('id').range(offset,offset+limit-1).abortSignal(signal)
    if(error) throw error
    if(!Array.isArray(data) || typeof count!=='number') throw new IncompleteReadError()
    return {items:data,total:count}
  },row=>row.id,signal)
  if(rows.some(row=>!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id)) || typeof row.full_name!=='string' || !row.full_name.trim())) throw new Error('Daftar manajer tidak lengkap.')
  return rows
}
export function SalesMetricsPanel({group='customer'}: {group?: SalesMetricGroup}) {
  const read = useSalesMetrics(group)
  const leadership = ['sales_head','executive'].includes(read.role)
  const directory=useQuery({queryKey:[...read.key,'managers'],queryFn:({signal})=>fetchManagers(signal),enabled:read.allowed&&read.valid&&leadership,retry:false})
  const options=salesMonthOptions(read.months?.earliest_month,read.from,read.through)
  const managerOptions=read.allowed&&!directory.isError&&!directory.isFetching ? directory.data : undefined
  const data=read.data
  return <section aria-label="Metrik Sales" className="min-w-0 space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900">Metrik Sales</h2><p className="text-sm text-gray-500">Bulan kalender utuh · {group==='customer'?'per pelanggan':'per kredit orang'}</p></div><button type="button" className={BUTTON} disabled={!read.allowed||!read.valid||read.pending} onClick={read.refresh}>Muat ulang metrik</button></div>
    {!read.allowed ? <p role="alert">Metrik Sales tidak tersedia untuk akun ini.</p> : !read.valid ? <div role="alert">Filter metrik tidak valid. <button className={BUTTON} onClick={read.reset}>Atur ulang filter</button></div> : <>
      <div className="flex flex-wrap gap-3">
        <label className="grid min-w-0 gap-1 text-sm text-gray-600">Dari bulan<select className={INPUT} value={read.from} onChange={event=>read.update({sales_from:event.target.value,...(event.target.value>read.through?{sales_through:event.target.value}:{})})}>{options.map(month=><option key={month} value={month}>{salesMonthLabel(month)}</option>)}</select></label>
        <label className="grid min-w-0 gap-1 text-sm text-gray-600">Sampai bulan<select className={INPUT} value={read.through} onChange={event=>read.update({sales_through:event.target.value,...(event.target.value<read.from?{sales_from:event.target.value}:{})})}>{options.map(month=><option key={month} value={month}>{salesMonthLabel(month)}</option>)}</select></label>
        <label className="grid min-w-0 gap-1 text-sm text-gray-600">Jenis pesanan<select className={INPUT} value={read.orderType} onChange={event=>read.update({sales_type:event.target.value})}><option value="all">PO dan CO</option><option value="po">PO</option><option value="co">CO</option></select></label>
        {leadership&&<label className="grid min-w-0 gap-1 text-sm text-gray-600">Manajer<select className={INPUT} value={read.manager??''} onChange={event=>read.update({sales_manager:event.target.value||null})}><option value="">Semua cakupan yang diizinkan</option>{read.manager&&!managerOptions?.some(manager=>manager.id===read.manager)&&<option value={read.manager}>Manajer terpilih</option>}{managerOptions?.map(manager=><option key={manager.id} value={manager.id}>{manager.full_name}</option>)}</select></label>}
      </div>
      {directory.isError&&leadership&&<p role="alert" className="text-sm text-red-700">Daftar manajer tidak tersedia. <button className="underline" onClick={()=>void directory.refetch()}>Muat ulang daftar manajer</button></p>}
      {read.manager&&<p className="text-xs text-gray-500">Dibatasi ke manajer terpilih, tetap dalam cakupan akun yang diizinkan.</p>}
      {read.months?.earliest_month===null&&<p className="text-sm text-gray-500">Belum ada bulan metrik dalam cakupan dan jenis pesanan ini.</p>}
      {read.unavailable ? <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">Data atau daftar bulan metrik Sales tidak tersedia. <button className="underline" onClick={read.refresh}>Coba lagi</button></div> : !data ? <p role="status" className="py-6 text-sm text-gray-500">Memuat metrik Sales...</p> : <>
        <p className="text-sm text-gray-600">Cakupan: {({own:'sendiri',team:'tim',leadership:'leadership'} as const)[data.scope]}</p>
        <SalesMetricSummary summary={data.summary}/>
        <section aria-label={group==='person'?'Kontribusi per orang':'Metrik per pelanggan'} className="space-y-4">
          <h2 className="font-semibold text-gray-900">{group==='person'?'Kontribusi per orang':'Metrik per pelanggan'}</h2>
          {data.group_by==='person'&&<p className="text-sm text-gray-600">Kontribusi laporan CO tidak dapat dijumlahkan antar orang. Satu laporan pelanggan/bulan dapat berkontribusi pada beberapa orang. Kredit mengikuti identitas asli saat CO dibuat, termasuk orang yang kini tidak aktif atau berubah peran; Unassigned berarti belum memiliki kredit.</p>}
          {data.items.length===0&&<p className="text-sm text-gray-500">{group==='person'?'Tidak ada kontribusi orang untuk periode ini. Laporan nol tetap dapat dihitung di ringkasan.':'Tidak ada metrik pelanggan untuk periode ini.'}</p>}
          {data.group_by==='customer' ? data.items.map(row=><section key={row.customer_id} aria-label={row.customer_name} className="min-w-0 space-y-3 border-t border-gray-200 pt-4"><h3 className="font-medium text-gray-900 [overflow-wrap:anywhere]">{row.customer_name}</h3><Values value={row}/><p className="text-xs text-gray-600">Laporan CO (pelanggan/bulan): {quantityText(row.co_report_event_count)}</p></section>) : data.items.map(row=><section key={row.person_id??'unassigned'} aria-label={row.person_name} className="min-w-0 space-y-3 border-t border-gray-200 pt-4"><h3 className="font-medium text-gray-900 [overflow-wrap:anywhere]">{row.person_name}</h3><Values value={row}/><p className="text-xs text-gray-600">Kontribusi laporan CO: {quantityText(row.co_contributing_report_count)}</p></section>)}
        </section>
        <COPagination page={data.page} pageSize={data.page_size} total={data.total} pending={read.pending} onPage={read.setPage}/>
        <p className="text-xs text-gray-500">Waktu pembacaan: {data.as_of}. Ini bukan tanggal cakupan laporan atau snapshot ekspor bersama.</p>
      </>}
    </>}
    <div className="space-y-2 border-t border-gray-100 pt-4 text-xs leading-relaxed text-gray-600">
      <p>PO Order Value: nilai PO confirm, in progress, atau complete berdasarkan tanggal PO. PO Delivered Revenue: kuantitas SJ positif dan tidak dibatalkan × harga asli item PO, berdasarkan tanggal SJ; jumlahnya menghitung PO berbeda, bukan jumlah SJ.</p>
      <p>CO Sold Revenue mencakup alokasi dari laporan bulanan yang sudah diposting, memakai harga dan kredit asli CO. Penjualan yang belum dilaporkan belum tercakup. Pengiriman CO dan draf bukan pendapatan.</p>
      <p>Laporan bulan berjalan dapat mencakup sebagian bulan. Nol yang dilaporkan berbeda dari laporan yang belum tersedia; angka ini tidak menyatakan seluruh penjualan sudah dilaporkan.</p>
      <p>Ringkasan mencakup seluruh hasil filter, bukan penjumlahan halaman. Jumlah PO, CO, dan laporan berbeda dihitung untuk seluruh rentang; jangan menjumlahkan hitungan bulan atau kontribusi orang.</p>
    </div>
  </section>
}
