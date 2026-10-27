// Entirely synthetic in-memory transport. No URL, key, credentials or network access.
export const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export const actor=id(1),customer=id(2),historicalCustomer=id(3),generation=id(4);
const today=()=>new Date().toISOString().slice(0,10),asOf=()=>new Date().toISOString();
export const profile={id:actor,full_name:'Synthetic CO Operator',email:'co@example.invalid',role:'co_admin',is_active:true,manager_id:null};
export const stockItems=[
 {stock_key_id:id(10),display_sku:'CAT-001',product_name:'Cat tembok putih 5 kg',available_quantity:'40',unit:'PCS',unit_version:'1',unit_id:id(20)},
 {stock_key_id:id(11),display_sku:'KUAS-002',product_name:'Kuas dinding 3 inci',available_quantity:'15',unit:'BOX',unit_version:'1',unit_id:id(21)},
 {stock_key_id:id(12),display_sku:'SEMEN-003',product_name:'Semen instan abu-abu',available_quantity:'8',unit:null,unit_version:null,unit_id:null},
];
type Payload={customer_id:string;return_date:string;reference:string|null;reason:string;notes:string|null;items:{stock_key_id:string;quantity:number}[]};
const initial:Payload={customer_id:customer,return_date:today(),reference:'RET-CONTOH-01',reason:'Kemasan rusak sebelum terjual',notes:'Data demonstrasi lokal',items:[{stock_key_id:id(10),quantity:3},{stock_key_id:id(11),quantity:1}]};
export const fixture={scenario:'success',calls:[] as {name:string;args:any}[],holdItems:false,releaseItems:null as null|(()=>void),commits:0,version:'7',records:[{head:id(30),revision:id(31),payload:initial}],requests:new Map<string,{payload:string;result:any}>()};
const ok=(data:any)=>({data,error:null});
function page(a:any,rows:any[],extra={}){return {version:'1',as_of:asOf(),page:a.p_page,page_size:a.p_page_size,total:String(rows.length),rows:rows.slice((a.p_page-1)*a.p_page_size,a.p_page*a.p_page_size),...extra};}
function summaries(p:Payload){const units=new Map<string|null,number>();for(const i of p.items){const u=stockItems.find(s=>s.stock_key_id===i.stock_key_id)?.unit??null;units.set(u,(units.get(u)??0)+i.quantity)}return [...units].map(([unit,q])=>({unit,quantity:String(q)}));}
export async function fixtureRPC(name:string,a:any={}){
 fixture.calls.push({name,args:a});
 if(name==='pilot_my_profile')return ok(profile);
 if(name==='pilot_co_return_customers_v1'||name==='pilot_co_return_history_customers_v1'){
  const rows=[{customer_id:customer,customer_name:'Toko Contoh Nusantara'},...(name==='pilot_co_return_history_customers_v1'?[{customer_id:historicalCustomer,customer_name:'Toko Riwayat — stok sudah habis'}]:[])].filter(r=>r.customer_name.toLowerCase().includes(a.p_search.toLowerCase()));
  return ok(page(a,rows,{search:a.p_search}));
 }
 if(name==='pilot_co_return_items_v1'){
  if(fixture.holdItems)await new Promise<void>(r=>fixture.releaseItems=r);
  if(a.p_customer_id!==customer)throw Error('Synthetic customer identity mismatch');
  const rows=stockItems.filter(r=>`${r.display_sku} ${r.product_name}`.toLowerCase().includes(a.p_search.toLowerCase()));
  return ok(page(a,rows,{customer_id:customer,customer_version:fixture.version,generation_id:generation,search:a.p_search}));
 }
 if(name==='pilot_co_returns_page_v1'){
  const rows=fixture.records.filter(r=>(!a.p_customer_id||r.payload.customer_id===a.p_customer_id)&&(!a.p_date_from||r.payload.return_date>=a.p_date_from)&&(!a.p_date_to||r.payload.return_date<=a.p_date_to)).map(r=>({id:r.head,revision_id:r.revision,customer_id:r.payload.customer_id,customer_name:'Toko Contoh Nusantara',return_date:r.payload.return_date,reference:r.payload.reference,reason:r.payload.reason,is_void:false,item_count:String(r.payload.items.length),quantities:summaries(r.payload)}));
  return ok(page(a,rows,{customer_id:a.p_customer_id,date_from:a.p_date_from,date_to:a.p_date_to}));
 }
 if(name==='pilot_co_return_create_v1'){
  const existing=fixture.requests.get(a.p_request_id);if(existing){if(existing.payload!==JSON.stringify(a.p_payload))return {data:null,error:{code:'PT409',message:'CO_RETURN_REQUEST_CONFLICT'}};return ok(existing.result)}
  if(fixture.scenario==='reject')return {data:null,error:{code:'PT409',message:'CO_VERSION_CONFLICT'}};
  const p=a.p_payload as Payload;
  if(p.items.some(i=>!stockItems.some(s=>s.stock_key_id===i.stock_key_id&&s.unit&&i.quantity>0&&i.quantity<=Number(s.available_quantity))))throw Error('Synthetic invalid create');
  const head=id(100+fixture.commits*2),revision=id(101+fixture.commits*2);fixture.commits++;fixture.version=String(Number(fixture.version)+1);
  const result={version:'1',request_id:a.p_request_id,customer_id:customer,head_id:head,revision_id:revision,customer_version:fixture.version,return_version:'1'};
  fixture.records.unshift({head,revision,payload:structuredClone(p)});fixture.requests.set(a.p_request_id,{payload:JSON.stringify(p),result});
  for(const i of p.items){const s=stockItems.find(s=>s.stock_key_id===i.stock_key_id)!;s.available_quantity=String(Number(s.available_quantity)-i.quantity)}
  if(fixture.scenario==='uncertain')throw new Error('Synthetic response lost after commit');
  return ok(result);
 }
 if(name==='pilot_co_return_create_result_v1'){const r=fixture.requests.get(a.p_request_id);return ok({version:'1',status:r?'committed':'not_found',result:r?.result??null})}
 if(name==='pilot_co_customer_stock_v1')return ok(page(a,[],{customer_id:customer,customer_version:fixture.version,generation_id:generation,stock_as_of:null,normalized_search:'',reporting_freshness:{cutoff_date:today(),next_required_report_month:null,pending_report_month_count:'0',overdue_report_month_count:'0',next_required_month_end:null,days_since_pending_month_end:null,status:'complete',zero_stock_reporting_pending:false},period_start:today().slice(0,8)+'01',coverage_date:today(),summary:{opening_quantity:'0',delivered_quantity:'0',sold_quantity:'0',returned_quantity:'0',recorded_quantity:'0'}}));
 if(name==='pilot_co_return_v1'){
  const r=fixture.records.find(r=>r.revision===a.p_target_id);if(!r)throw Error('Synthetic revision missing');const p=r.payload;
  const rows=p.items.map((i,n)=>{const stock=stockItems.find(s=>s.stock_key_id===i.stock_key_id)!;return {id:id(300+n),customer_id:customer,co_id:id(400+n),co_number:`CO-CONTOH-${n+1}`,co_line_id:id(500+n),stock_key_id:i.stock_key_id,batch_id:id(600+n),revision_id:r.revision,draft_id:null,quantity:String(i.quantity),unit_price:'10000.00',display_sku:stock.display_sku,product_name:stock.product_name}});
  return ok(page(a,rows,{customer_id:customer,customer_version:fixture.version,target_id:a.p_target_id,view:'revision',draft_version:null,header:{id:r.revision,customer_id:customer,target_kind:'revision',draft_version:null,head_id:r.head,head_version:'1',revision_id:r.revision,revision_no:'1',return_date:p.return_date,reference:p.reference,reason:p.reason,notes:p.notes,consumed:false,bound_customer_version:null,bindings_current:true,line_count:String(rows.length),is_void:false}}));
 }
 throw Error(`Forbidden/unhandled synthetic RPC: ${name}`);
}
export const supabase={
 supabaseUrl:'http://synthetic.invalid',rest:{url:'http://synthetic.invalid/rest/v1',schemaName:'public'},
 auth:{getSession:async()=>({data:{session:{user:{id:actor}}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null})},
 rpc:(name:string,args:any={})=>{const promise=fixtureRPC(name,args);return Object.assign(promise,{abortSignal:()=>promise,single:()=>promise});},
 from:()=>{throw Error('Table access forbidden in return browser fixture')},
};
