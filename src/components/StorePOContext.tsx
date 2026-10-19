import { LoadingState } from './ui/LoadingState'
import { Button } from './ui/Button'
import { Section } from './ui/Section'
import { FormActions } from './ui/FormActions'
import { EmptyState, Notice, StatusBadge } from './ui/Feedback'
import { PO_STATUS_LABELS } from '../lib/orderPresentation'
import { formatDisplayDate } from '../lib/displayDate'
import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { calendarDateKey } from '../lib/calendarDate'
export type StorePOPage = {version:1;as_of:string;latest_po_date:string|null;range_from:string;range_through:string;items:{id:string;po_number:string;order_date:string;status:string}[];total:number;page:number;page_size:number}
export async function fetchStorePOContext(customerId:string,page:number):Promise<StorePOPage> {
 const {data,error}=await supabase.rpc('pilot_store_po_context_v1',{p_customer_id:customerId,p_page:page,p_page_size:20})
 if(error) throw error
 const date=(value:unknown)=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
 if(!data || data.version!==1 || typeof data.as_of!=='string' || !(data.latest_po_date===null || date(data.latest_po_date)) || !date(data.range_from) || !date(data.range_through) || !Number.isSafeInteger(data.total) || data.total<0 || data.page!==page || data.page_size!==20 || !Array.isArray(data.items) || data.items.length>20 || data.items.some((item:StorePOPage['items'][number])=>!item || typeof item.id!=='string' || typeof item.po_number!=='string' || !date(item.order_date) || typeof item.status!=='string')) throw new Error('Respons riwayat PO tidak valid.')
 return data as StorePOPage
}
export default function StorePOContext({customerId,collapsible=false}:{customerId:string;collapsible?:boolean}) {
 const {profile}=useAuth()
 return <StorePOContextPage key={`${profile?.id}:${profile?.role}:${customerId}`} customerId={customerId} collapsible={collapsible}/>
}
function StorePOContextPage({customerId,collapsible}:{customerId:string;collapsible:boolean}) {
 const [expanded,setExpanded]=useState(false);const contentId=useId()
 const {profile}=useAuth(); const [page,setPage]=useState(1); const [day,setDay]=useState(calendarDateKey()); const [serverWindow,setServerWindow]=useState<string|null>(null)
 useEffect(()=>{const id=window.setInterval(()=>setDay(calendarDateKey()),60000);return()=>window.clearInterval(id)},[])
 const query=useQuery({queryKey:['store_po_context',profile?.id,profile?.role,customerId,day,serverWindow,page],queryFn:()=>fetchStorePOContext(customerId,page),enabled:!!profile?.id && !!customerId,staleTime:0,refetchOnMount:'always'})
 const responseWindow=query.data ? `${query.data.range_from}:${query.data.range_through}` : null
 useEffect(()=>{if(responseWindow && responseWindow!==serverWindow){if(serverWindow && page!==1)setPage(1);setServerWindow(responseWindow)}},[responseWindow,serverWindow,page])
 // Background revalidation also conceals prior results until current authority is verified.
 return <Section title={collapsible ? "Riwayat PO toko" : "Pesanan pembelian (PO) toko"} aria-label="Riwayat PO toko" className="space-y-3">
  {query.isError ? <Notice tone="error" title="Riwayat PO belum tersedia." actions={<Button size="compact" variant="secondary" onClick={()=>query.refetch()}>Coba lagi</Button>} />
   : query.isFetching || !query.data || responseWindow!==serverWindow ? <LoadingState title="Memuat riwayat PO..." shape="list" /> : <>
   <p>PO terakhir (seluruh riwayat): {query.data.latest_po_date ? formatDisplayDate(query.data.latest_po_date) : 'Belum ada PO'}</p>
   <p className="text-sm text-brand-secondary">Rentang status: {formatDisplayDate(query.data.range_from)} – {formatDisplayDate(query.data.range_through)}</p>
   {collapsible && <Button variant="secondary" className="w-full" aria-expanded={expanded} aria-controls={contentId} onClick={()=>setExpanded(value=>!value)}>{expanded ? 'Tutup riwayat PO' : `Lihat riwayat PO (${query.data.total})`}</Button>}
   <div id={contentId}>{(!collapsible || expanded) && <>
   {query.data.items.length===0 ? <EmptyState title="Tidak ada PO pada rentang ini." /> : <ul className="divide-y">{query.data.items.map(item=><li key={item.id} className="py-2 flex flex-wrap justify-between gap-2"><span>{item.po_number} · {formatDisplayDate(item.order_date)}</span><StatusBadge tone={item.status==='complete'?'success':item.status==='cancelled'?'error':item.status==='in_progress'?'warning':'neutral'}>{PO_STATUS_LABELS[item.status] ?? item.status}</StatusBadge></li>)}</ul>}
   <FormActions className={collapsible ? "grid grid-cols-2 gap-2" : "justify-between"}><Button size="compact" variant="quiet" disabled={page===1} onClick={()=>setPage(page-1)}>Sebelumnya</Button><span className={collapsible ? "col-span-2 row-start-1 text-sm text-brand-secondary" : "text-[13px] text-brand-secondary"}>Halaman {page}</span><Button size="compact" variant="quiet" disabled={page*20>=query.data.total} onClick={()=>setPage(page+1)}>Berikutnya</Button></FormActions>
   </>}</div>
  </>}
 </Section>
}
