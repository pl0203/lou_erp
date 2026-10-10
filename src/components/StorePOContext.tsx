import { useEffect, useState } from 'react'
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
export default function StorePOContext({customerId}:{customerId:string}) {
 const {profile}=useAuth()
 return <StorePOContextPage key={`${profile?.id}:${profile?.role}:${customerId}`} customerId={customerId}/>
}
function StorePOContextPage({customerId}:{customerId:string}) {
 const {profile}=useAuth(); const [page,setPage]=useState(1); const [day,setDay]=useState(calendarDateKey()); const [serverWindow,setServerWindow]=useState<string|null>(null)
 useEffect(()=>{const id=window.setInterval(()=>setDay(calendarDateKey()),60000);return()=>window.clearInterval(id)},[])
 const query=useQuery({queryKey:['store_po_context',profile?.id,profile?.role,customerId,day,serverWindow,page],queryFn:()=>fetchStorePOContext(customerId,page),enabled:!!profile?.id && !!customerId,staleTime:0,refetchOnMount:'always'})
 const responseWindow=query.data ? `${query.data.range_from}:${query.data.range_through}` : null
 useEffect(()=>{if(responseWindow && responseWindow!==serverWindow){if(serverWindow && page!==1)setPage(1);setServerWindow(responseWindow)}},[responseWindow,serverWindow,page])
 // Background revalidation also conceals prior results until current authority is verified.
 return <section aria-label="Riwayat Purchase Order toko" className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
  <h2 className="text-base font-medium text-gray-900">Purchase Order toko</h2>
  {query.isError ? <div role="alert">Riwayat PO belum tersedia. <button className="underline" onClick={()=>query.refetch()}>Coba lagi</button></div>
   : query.isFetching || !query.data || responseWindow!==serverWindow ? <p role="status">Memuat riwayat PO...</p> : <>
   <p>PO terakhir (seluruh riwayat): {query.data.latest_po_date ?? 'Belum ada PO'}</p>
   <p className="text-sm text-gray-500">Rentang status: {query.data.range_from} – {query.data.range_through}</p>
   {query.data.items.length===0 ? <p>Tidak ada PO pada rentang ini.</p> : <ul className="divide-y">{query.data.items.map(item=><li key={item.id} className="py-2 flex flex-wrap justify-between gap-2"><span>{item.po_number} · {item.order_date}</span><span>{item.status}</span></li>)}</ul>}
   <div className="flex justify-between text-sm"><button disabled={page===1} onClick={()=>setPage(page-1)}>Sebelumnya</button><span>Halaman {page}</span><button disabled={page*20>=query.data.total} onClick={()=>setPage(page+1)}>Berikutnya</button></div>
  </>}
 </section>
}
