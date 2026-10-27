import {useState} from 'react';
import {useUnsavedChanges} from '../../lib/useUnsavedChanges';
import {useBeforeSignOut} from '../../lib/AuthContext';
import {Dialog} from '../ui/Dialog';
import {Button} from '../ui/Button';
import {Field} from '../ui/Field';
import {CO_INPUT,COFailure,COPagination,useCOActor,useCORead,quantityText} from './COShared';
import {fetchReturnCustomers,fetchReturnItems,type ReturnCustomer,type ReturnPayload,type ReturnItem} from '../../lib/co/returnWorkspace';
import {buildReturnPayload,returnDateDefaults,type ReturnEntry} from '../../lib/co/returnForm';
import './COReturnWorkspace.css';
type Props={onClose:()=>void;onSubmit:(payload:ReturnPayload)=>Promise<void>;returnFocus:HTMLElement|null;frozen?:boolean;blockedCustomers?:readonly string[]};
export default function COReturnCreateModal({onClose,onSubmit,returnFocus,frozen=false,blockedCustomers=[]}:Props){
 const actor=useCOActor('return-create');
 const [customer,setCustomer]=useState<ReturnCustomer|null>(null),[search,setSearch]=useState(''),[customerPage,setCustomerPage]=useState(1);
 const [itemSearch,setItemSearch]=useState(''),[itemPage,setItemPage]=useState(1),[entries,setEntries]=useState<ReturnEntry[]>([]);
 const [binding,setBinding]=useState<{version:string;generation:string}|null>(null);
 const [date,setDate]=useState(()=>returnDateDefaults().date),[reason,setReason]=useState(''),[reference,setReference]=useState(''),[notes,setNotes]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
 const ca={p_search:search,p_page:customerPage,p_page_size:10};
 const customers=useCORead(actor,'return-customers',ca,o=>fetchReturnCustomers(ca,o),!customer);
 const ia={p_customer_id:customer?.customer_id??'',p_search:itemSearch,p_expected_customer_version:binding?.version??null,p_page:itemPage,p_page_size:10};
 const items=useCORead(actor,'return-items',ia,o=>fetchReturnItems(ia,o),!!customer);
 const disabled=busy||frozen||!actor.enabled;
 const unsaved=useUnsavedChanges(entries.length>0||!!reason||!!reference||!!notes||busy);
 useBeforeSignOut(signal=>unsaved.confirmDiscardDecision({signal}),actor.scope);
 function choose(c:ReturnCustomer){setCustomer(c);setBinding(null);setEntries([]);setItemSearch('');setItemPage(1);setError(null);}
 function changeCustomer(){unsaved.confirmDiscard(()=>{setCustomer(null);setBinding(null);setEntries([]);setError(null);},{when:entries.length>0,message:'Ganti toko dan hapus pilihan barang?'});}
 function add(item:ReturnItem){const data=items.data;if(disabled||items.isFetching||!data||items.error||!item.unit||!item.unit_id||!item.unit_version)return;if(binding&&(binding.version!==data.customer_version||binding.generation!==data.generation_id))return;setBinding({version:data.customer_version,generation:data.generation_id});setEntries(old=>old.some(e=>e.item.stock_key_id===item.stock_key_id)?old:[...old,{item,quantity:''}]);}
 function close(){if(disabled)return;unsaved.confirmDiscard(onClose);}
 async function refreshStock(){if(disabled||!customer)return;setBusy(true);setError(null);try{
  const updated:ReturnEntry[]=[];let next:{version:string;generation:string}|null=null;
  for(const row of entries){let item:ReturnItem|undefined;let readPage=1;
   while(!item){const data=await actor.protect(()=>fetchReturnItems({p_customer_id:customer.customer_id,p_search:row.item.display_sku,p_expected_customer_version:next?.version??null,p_page:readPage,p_page_size:100},{isCurrent:actor.isCurrent}));
    if(next&&(next.version!==data.customer_version||next.generation!==data.generation_id))throw new Error('Data stok berubah selama pemeriksaan. Coba lagi.');next={version:data.customer_version,generation:data.generation_id};
    item=data.rows.find(i=>i.stock_key_id===row.item.stock_key_id);if(item||BigInt(readPage)*100n>=BigInt(data.total))break;if(readPage>=2147483647)throw new Error('Terlalu banyak hasil stok. Hubungi administrator.');readPage++;
   }
   if(!item)throw new Error(`${row.item.display_sku} tidak lagi tersedia. Hapus baris dan pilih ulang barang.`);
   if(item.unit_id!==row.item.unit_id||item.unit_version!==row.item.unit_version||item.unit!==row.item.unit)throw new Error(`Satuan ${row.item.display_sku} berubah. Hapus baris dan pilih ulang; jumlah tidak dikonversi.`);
   updated.push({item,quantity:row.quantity});
  }
  if(actor.isCurrent()){setEntries(updated);setBinding(next);await items.refetch();}
 }catch(e){if(actor.isCurrent())setError(e);}finally{if(actor.isCurrent())setBusy(false);}}
 async function submit(){if(disabled)return;setError(null);try{const payload=buildReturnPayload({customerId:customer?.customer_id??'',customerVersion:binding?.version??'',generationId:binding?.generation??'',date,reason,reference,notes,entries});setBusy(true);await onSubmit(payload);}catch(e){if(actor.isCurrent())setError(e);}finally{if(actor.isCurrent())setBusy(false);}}
 return <><Dialog labelledBy="return-create-title" pending={disabled} onClose={close} returnFocus={returnFocus} fallbackFocus={()=>document.querySelector('h1')} className="co-return-dialog">
  <header className="co-return-dialog__header"><div><h2 id="return-create-title">Create Stock Return</h2><p>Catat barang belum terjual yang dikembalikan toko.</p></div><Button variant="quiet" disabled={disabled} onClick={close} aria-label="Tutup form retur">×</Button></header>
  <form onSubmit={e=>{e.preventDefault();void submit();}}>
   <div className="co-return-dialog__body">
    {error&&<COFailure error={error}/>}
    <fieldset disabled={disabled} className="co-return-fields">
     <legend className="sr-only">Informasi retur</legend>
     <div className="co-return-customer"><span className="ui-field__label">Toko</span>{customer?<div className="co-return-selected"><strong>{customer.customer_name}</strong><Button variant="quiet" size="compact" onClick={changeCustomer}>Ganti</Button></div>:<>
      <Field id="return-customer-search" label="Cari toko">{a=><input {...a} className={CO_INPUT} maxLength={200} value={search} onChange={e=>{setSearch(e.target.value);setCustomerPage(1);}} placeholder="Nama toko"/>}</Field>
      {customers.isFetching&&<p role="status">Memuat toko…</p>}{customers.error&&<COFailure error={customers.error} retry={()=>void customers.refetch()}/>}
      {!customers.isFetching&&!customers.error&&customers.data&&<div className="co-return-options">{customers.data.rows.map(c=><Button key={c.customer_id} variant="quiet" disabled={blockedCustomers.includes(c.customer_id)} onClick={()=>choose(c)}>{c.customer_name}{blockedCustomers.includes(c.customer_id)?' · Pulihkan retur sebelumnya':''}</Button>)}{!customers.data.rows.length&&<p>Tidak ada toko dengan stok CO tersedia.</p>}<COPagination page={customerPage} pageSize={10} total={customers.data.total} pending={customers.isFetching} onPage={setCustomerPage}/></div>}
     </>}</div>
     <Field id="return-date" label="Tanggal retur" hint={returnDateDefaults().wibToday>returnDateDefaults().cutoff?`Tanggal barang benar-benar dikembalikan. Batas ledger saat ini: ${returnDateDefaults().cutoff} (UTC). Jangan mengganti tanggal sebenarnya.`:undefined}>{a=><input {...a} className={CO_INPUT} type="date" value={date} onChange={e=>setDate(e.target.value)} required/>}</Field>
     <Field id="return-reason" label="Alasan retur">{a=><input {...a} className={CO_INPUT} value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} required/>}</Field>
     <Field id="return-reference" label="Referensi (opsional)">{a=><input {...a} className={CO_INPUT} value={reference} maxLength={200} onChange={e=>setReference(e.target.value)}/>}</Field>
    </fieldset>
    <section aria-labelledby="return-items-title"><div className="co-return-section-title"><h3 id="return-items-title">Barang yang dikembalikan</h3>{entries.length>0&&<Button variant="quiet" size="compact" disabled={disabled} onClick={()=>void refreshStock()}>Periksa stok terbaru</Button>}</div>
     <Field id="return-item-search" label="Cari SKU atau nama barang">{a=><input {...a} className={CO_INPUT} maxLength={200} value={itemSearch} disabled={disabled} onChange={e=>{setItemSearch(e.target.value);setItemPage(1);}} placeholder="Cari barang"/>}</Field>
     {!customer&&<p>Pilih toko untuk melihat barang yang tersedia.</p>}
     {customer&&items.isFetching&&<p role="status">Memuat stok… Anda tetap dapat mengetik pencarian.</p>}
     {customer&&items.error&&<COFailure error={items.error} retry={()=>void items.refetch()}/>}
     {customer&&!items.isFetching&&!items.error&&items.data&&<div className="co-return-options">{items.data.rows.map(item=><div key={item.stock_key_id} className="co-return-option"><div><strong>{item.display_sku}</strong><span>{item.product_name}</span><small>{quantityText(item.available_quantity)} {item.unit??'Satuan belum terverifikasi'}</small></div><Button variant="secondary" size="compact" aria-label={`Tambah ${item.display_sku}`} disabled={disabled||!item.unit||entries.some(e=>e.item.stock_key_id===item.stock_key_id)||entries.length>=100} onClick={()=>add(item)}>Tambah</Button></div>)}{!items.data.rows.length&&<p>Tidak ada barang tersedia sesuai pencarian.</p>}<COPagination page={itemPage} pageSize={10} total={items.data.total} pending={items.isFetching} onPage={setItemPage}/></div>}
     <div className="co-return-table-scroll"><table className="co-return-table co-return-selected-table"><thead><tr><th>SKU / Nama barang</th><th>Stok toko</th><th>Qty retur</th><th>Satuan</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{entries.map(({item,quantity})=><tr key={item.stock_key_id}><td><strong>{item.display_sku}</strong><span>{item.product_name}</span></td><td data-label="Stok toko">{quantityText(item.available_quantity)}</td><td data-label="Qty retur"><input className={CO_INPUT} aria-label={`Qty retur ${item.display_sku}`} inputMode="numeric" value={quantity} disabled={disabled} onChange={e=>setEntries(old=>old.map(row=>row.item.stock_key_id===item.stock_key_id?{...row,quantity:e.target.value}:row))}/></td><td data-label="Satuan">{item.unit}</td><td><Button variant="quiet" size="compact" disabled={disabled} aria-label={`Hapus ${item.display_sku}`} onClick={()=>{setEntries(old=>old.filter(e=>e.item.stock_key_id!==item.stock_key_id));if(entries.length===1)setBinding(null);}}>Hapus</Button></td></tr>)}{!entries.length&&<tr><td colSpan={5}>Belum ada barang dipilih.</td></tr>}</tbody></table></div>
    </section>
    <details><summary>Tambahkan catatan (opsional)</summary><Field id="return-notes" label="Catatan">{a=><textarea {...a} className={CO_INPUT} disabled={disabled} value={notes} maxLength={4000} rows={2} onChange={e=>setNotes(e.target.value)}/>}</Field></details>
   </div>
   <footer className="co-return-dialog__footer"><span>{entries.length} SKU dipilih</span><div><Button variant="secondary" disabled={disabled} onClick={close}>Batal</Button><Button type="submit" disabled={disabled||!customer||!entries.length} pending={busy}>{busy?'Mencatat…':'Catat retur'}</Button></div></footer>
  </form>
 </Dialog>{unsaved.dialog}</>;
}
