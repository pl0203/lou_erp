import COReturnLegacyRecovery from '../../../components/co/COReturnLegacyRecovery';
import {legacyReturnCustomers} from '../../../lib/co/returnLegacyRecovery';
import {useEffect,useMemo,useRef,useState} from 'react';
import {PageHeader} from '../../../components/ui/PageHeader';
import {Button} from '../../../components/ui/Button';
import {StatusBadge} from '../../../components/ui/Feedback';
import {Field} from '../../../components/ui/Field';
import {Dialog} from '../../../components/ui/Dialog';
import {CO_INPUT,COFailure,COPagination,useCOActor,useCORead,quantityText} from '../../../components/co/COShared';
import COSourceBoundary from '../../../components/co/COSourceBoundary';
import COReturnCreateModal from '../../../components/co/COReturnCreateModal';
import {fetchReturnPage,fetchReturnHistoryCustomers,createStockReturn,recoverStockReturn,type ReturnListRow,type ReturnPayload} from '../../../lib/co/returnWorkspace';
import {createReturnRequest} from '../../../lib/co/returnRequest';
import {verifyReturnReadback} from '../../../lib/co/returnForm';
import {fetchCOCustomerStock,fetchCompleteCOReturn} from '../../../lib/co/rpc';
import {CO_BACKEND,coKeys} from '../../../lib/co/queryKeys';
import {formatMoney} from '../../../lib/reads/money';
import {minorUnits} from '../../../lib/co/validation';
import {formatCOMinorUnits} from '../../../lib/co/catalog';
import {formatDisplayDate} from '../../../lib/displayDate';
import '../../../components/co/COReturnWorkspace.css';
const first={p_customer_id:null,p_date_from:null,p_date_to:null,p_page:1,p_page_size:20};
export default function COStockReturns(){return <COSourceBoundary source="return-workspace" check={o=>fetchReturnPage(first,o)}><ReturnGate/></COSourceBoundary>;}
function ReturnGate(){const actor=useCOActor('return-workspace');return actor.enabled?<ReturnWorkspace key={actor.scope}/>:null;}
function ReturnWorkspace(){
 const actor=useCOActor('return-workspace');const [page,setPage]=useState(1),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [open,setOpen]=useState(false),[error,setError]=useState<unknown>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[tick,setTick]=useState(0);
 const [customerId,setCustomerId]=useState<string|null>(null),[customerSearch,setCustomerSearch]=useState(''),[customerPage,setCustomerPage]=useState(1),[customerName,setCustomerName]=useState('Semua toko'),[filterOpen,setFilterOpen]=useState(false);
 const [legacyCustomer,setLegacyCustomer]=useState<string|null>(null);
 useEffect(()=>{const changed=()=>setTick(n=>n+1);window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed)},[]);
 let legacy:ReturnType<typeof legacyReturnCustomers>=[],legacyFailure:unknown=null;try{legacy=legacyReturnCustomers(window.localStorage,actor.identity.actorId,CO_BACKEND);}catch(e){legacyFailure=e;}
 const [detail,setDetail]=useState<ReturnListRow|null>(null);const trigger=useRef<HTMLElement|null>(null);
 const args={...first,p_customer_id:customerId,p_page:page,p_date_from:from||null,p_date_to:to||null};
 const customerArgs={p_search:customerSearch,p_page:customerPage,p_page_size:10};
 const historyCustomers=useCORead(actor,'return-history-customers',customerArgs,o=>fetchReturnHistoryCustomers(customerArgs,o),filterOpen);
 const validDates=!from||!to||from<=to;
 const list=useCORead(actor,'return-list',args,o=>fetchReturnPage(args,o),validDates);
 const sender=useMemo(()=>createReturnRequest({...actor.identity,backend:CO_BACKEND,storage:{getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>window.localStorage.setItem(key,value),removeItem:key=>window.localStorage.removeItem(key)},current:actor.isCurrent,
  authorize:async()=>{if(!actor.isCurrent())throw new Error('Sesi berubah. Buka kembali halaman retur.');},
  send:(id,payload)=>actor.protect(()=>createStockReturn(id,payload,{isCurrent:actor.isCurrent})),
  recover:id=>actor.protect(()=>recoverStockReturn(id,{isCurrent:actor.isCurrent})),
  canonical:async(result,payload)=>{const fresh=await actor.protect(()=>fetchCOCustomerStock({p_customer_id:payload.customer_id,p_as_of:null,p_search:'',p_expected_customer_version:null,p_page:1,p_page_size:1},{isCurrent:actor.isCurrent}));const saved=await actor.protect(()=>fetchCompleteCOReturn({p_customer_id:payload.customer_id,p_target_id:result.revision_id,p_view:'revision',p_expected_customer_version:fresh.customer_version!,p_expected_draft_version:null},{isCurrent:actor.isCurrent}));verifyReturnReadback(result,payload,saved);}
 }),[actor.scope,actor.isCurrent]);
 let pending=false,storageError:unknown=null;try{pending=!!sender.pending();}catch(e){storageError=e;}
 async function completed(){if(!actor.isCurrent())return;setOpen(false);setMessage('Stock return berhasil dicatat.');setError(null);setTick(n=>n+1);await actor.client.invalidateQueries({queryKey:coKeys.identity(actor.identity)});}
 async function submit(payload:ReturnPayload){try{await sender.submit(payload);await completed();}catch(e){if(actor.isCurrent()){setTick(n=>n+1);if(sender.pending()){setOpen(false);setError(e);} }throw e;}}
 async function recover(retry:boolean){if(busy)return;setBusy(true);setError(null);try{const result=await (retry?sender.retry():sender.reconcile());if(result)await completed();else if(actor.isCurrent())setMessage('Hasil belum terkonfirmasi. Coba permintaan yang sama; jangan membuat retur baru.');}catch(e){if(actor.isCurrent())setError(e);}finally{if(actor.isCurrent()){setBusy(false);setTick(n=>n+1);}}}
 void tick;
 return <main><PageHeader title="Stock Return" actions={<Button disabled={pending||!!storageError||!!legacyFailure} onClick={e=>{trigger.current=e.currentTarget;setOpen(true);setMessage('');}}>Create Stock Return</Button>}/>
  {message&&<p role="status">{message}</p>}{(error||storageError||legacyFailure)&&<COFailure error={error||storageError||legacyFailure}/>}
  {legacy.length>0&&<section className="co-return-recovery" aria-label="Permintaan retur lama"><strong>Periksa permintaan retur sebelumnya</strong><p>Retur baru untuk toko yang sama menunggu hasil permintaan lama.</p>{legacy.map((entry,index)=><Button key={entry.customerId} variant="secondary" onClick={e=>{trigger.current=e.currentTarget;setLegacyCustomer(entry.customerId);}}>Pulihkan retur sebelumnya{legacy.length>1?` (${index+1})`:''}</Button>)}</section>}
  {legacyCustomer&&<COReturnLegacyRecovery customerId={legacyCustomer} returnFocus={trigger.current} onClose={()=>setLegacyCustomer(null)} onResolved={()=>{setTick(n=>n+1);void list.refetch();}}/>}
  {pending&&<section className="co-return-recovery" aria-label="Pemulihan retur"><strong>Periksa hasil retur sebelumnya</strong><p>Permintaan tersimpan. Pastikan hasilnya sebelum mencatat retur lain.</p><div><Button variant="secondary" disabled={busy} onClick={()=>void recover(false)}>Periksa hasil</Button><Button variant="quiet" disabled={busy} onClick={()=>void recover(true)}>Coba permintaan yang sama</Button></div></section>}
  <div className="co-return-filters"><div><span className="ui-field__label">Toko</span><Button variant="secondary" onClick={()=>setFilterOpen(v=>!v)} aria-expanded={filterOpen}>{customerName}</Button></div><Field id="return-from" label="Dari tanggal">{a=><input {...a} className={CO_INPUT} type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}}/>}</Field><Field id="return-to" label="Sampai tanggal">{a=><input {...a} className={CO_INPUT} type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1);}}/>}</Field></div>
  {filterOpen&&<section className="co-return-options" aria-label="Filter toko"><Field id="return-history-customer" label="Cari toko dalam riwayat retur">{a=><input {...a} className={CO_INPUT} maxLength={200} value={customerSearch} onChange={e=>{setCustomerSearch(e.target.value);setCustomerPage(1);}}/>}</Field><Button variant="quiet" onClick={()=>{setCustomerId(null);setCustomerName('Semua toko');setPage(1);setFilterOpen(false);}}>Semua toko</Button>{historyCustomers.isFetching&&<p role="status">Memuat toko…</p>}{historyCustomers.error&&<COFailure error={historyCustomers.error} retry={()=>void historyCustomers.refetch()}/>}{!historyCustomers.isFetching&&!historyCustomers.error&&historyCustomers.data&&<>{historyCustomers.data.rows.map(c=><Button variant="quiet" key={c.customer_id} onClick={()=>{setCustomerId(c.customer_id);setCustomerName(c.customer_name);setPage(1);setFilterOpen(false);}}>{c.customer_name}</Button>)}<COPagination page={customerPage} pageSize={10} total={historyCustomers.data.total} pending={historyCustomers.isFetching} onPage={setCustomerPage}/></>}</section>}
  {!validDates&&<COFailure error={new Error('Tanggal akhir harus sama atau setelah tanggal awal.')}/>}
  {list.isFetching&&<p role="status">Memuat stock return…</p>}{list.error&&<COFailure error={list.error} retry={()=>void list.refetch()}/>}
  {validDates&&!list.error&&list.data&&<><div className="co-return-table-scroll"><table className="co-return-table"><thead><tr><th>Tanggal retur</th><th>Toko</th><th>Referensi</th><th>Barang</th><th>Qty retur</th><th>Status</th><th>Actions</th></tr></thead><tbody>{list.data.rows.map(row=><tr key={row.id}><td>{formatDisplayDate(row.return_date)}</td><td>{row.customer_name}</td><td>{row.reference||'—'}</td><td>{quantityText(row.item_count)} SKU</td><td>{row.quantities.map(q=><span key={q.unit??'unknown'}>{q.unit?`${quantityText(q.quantity)} ${q.unit}`:'Satuan belum terverifikasi'}</span>)}</td><td><StatusBadge tone={row.is_void?'neutral':'success'}>{row.is_void?'Dibatalkan':'Tercatat'}</StatusBadge></td><td><Button variant="quiet" size="compact" onClick={e=>{trigger.current=e.currentTarget;setDetail(row);}}>Buka</Button></td></tr>)}</tbody></table>{!list.data.rows.length&&<p className="co-return-empty">Belum ada stock return pada periode ini.</p>}</div><COPagination page={page} total={list.data.total} pending={list.isFetching} onPage={setPage}/></>}
  {open&&<COReturnCreateModal blockedCustomers={legacy.map(x=>x.customerId)} onClose={()=>setOpen(false)} onSubmit={submit} returnFocus={trigger.current}/>}
  {detail&&<ReturnDetail key={detail.revision_id} row={detail} returnFocus={trigger.current} close={()=>setDetail(null)}/>}
 </main>;
}
function ReturnDetail({row,returnFocus,close}:{row:ReturnListRow;returnFocus:HTMLElement|null;close:()=>void}){
 const actor=useCOActor(`return-detail:${row.revision_id}`);
 const data=useCORead(actor,'return-detail',row,async o=>{const stock=await fetchCOCustomerStock({p_customer_id:row.customer_id,p_as_of:null,p_search:'',p_expected_customer_version:null,p_page:1,p_page_size:1},o);const saved=await fetchCompleteCOReturn({p_customer_id:row.customer_id,p_target_id:row.revision_id,p_view:'revision',p_expected_customer_version:stock.customer_version!,p_expected_draft_version:null},o);if(saved.header.head_id!==row.id||saved.header.revision_id!==row.revision_id)throw new Error('Identitas retur berubah. Muat ulang daftar.');return saved;});
 return <Dialog labelledBy="return-detail-title" pending={false} onClose={close} returnFocus={returnFocus} fallbackFocus={()=>document.querySelector('h1')} className="co-return-dialog"><header className="co-return-dialog__header"><div><h2 id="return-detail-title">Stock Return · {row.customer_name}</h2><p>{formatDisplayDate(row.return_date)}{row.reference?` · ${row.reference}`:''}</p></div><Button variant="quiet" onClick={close} aria-label="Tutup detail retur">×</Button></header><div className="co-return-dialog__body">{data.isFetching&&<p role="status">Memuat detail…</p>}{data.error&&<COFailure error={data.error} retry={()=>void data.refetch()}/>}{!data.error&&data.data&&<><p><strong>Alasan:</strong> {data.data.header.reason||'—'}</p><div className="co-return-table-scroll"><table className="co-return-table"><thead><tr><th>SKU / Nama barang</th><th>Qty retur</th><th>Harga satuan</th><th>Nilai retur</th><th>Sumber CO</th></tr></thead><tbody>{data.data.lines.map(line=><tr key={line.id}><td><strong>{line.display_sku}</strong><span>{line.product_name}</span></td><td>{quantityText(line.quantity)}</td><td>Rp {formatMoney(line.unit_price,'full')}</td><td>Rp {formatMoney(formatCOMinorUnits(BigInt(line.quantity)*minorUnits(line.unit_price)),'full')}</td><td>{line.co_number}</td></tr>)}</tbody></table></div>{data.data.header.notes&&<p>{data.data.header.notes}</p>}</>}</div><footer className="co-return-dialog__footer"><span/><Button variant="secondary" onClick={close}>Tutup</Button></footer></Dialog>;
}
