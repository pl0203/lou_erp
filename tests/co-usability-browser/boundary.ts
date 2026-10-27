// Local synthetic transport only. No real account, hosted API, or credentials.
export const actor = '00000000-0000-0000-0000-000000000001';
export const customer = '00000000-0000-0000-0000-000000000002';
const profile={id:actor,role:'co_admin',is_active:true};
export const useAuth=()=>({user:{id:actor},profile,loading:false,error:null});
export const useBeforeSignOut=()=>{};
export const fixture={holdProducts:true,holdStock:true,failProducts:false,calls:[] as any[],productRelease:null as null|(()=>void),stockRelease:null as null|(()=>void)};
const customers=[{id:customer,name:'Toko Contoh Nusantara',pricing_tier:'luar_kota',address:null,city:null,phone:null,email:null,customer_category:null,is_enabled:true,catalog_version:'1'}];
const products=Array.from({length:30},(_,i)=>({id:`10000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`,name:`Produk contoh ${i+1}`,sku:`SKU-${i+1}`,size:null,harga_pokok:0,luar_kota:10000,dalam_kota:null,depo_bangunan:null,unit_price:null,is_enabled:true,catalog_version:'1'}));
const fresh={cutoff_date:'2026-10-09',next_required_report_month:'2026-09-01',pending_report_month_count:'2',overdue_report_month_count:'1',next_required_month_end:'2026-09-30',days_since_pending_month_end:'9',status:'missing_completed_period',zero_stock_reporting_pending:false};
const ok=(data:any)=>({data,error:null});
async function rpc(name:string,a:any){
 fixture.calls.push({name,args:a});
 if(name==='pilot_my_profile')return ok([profile]);
 if(name==='pilot_catalog_page_v1'){
  if(a.p_kind==='product'&&fixture.holdProducts)await new Promise<void>(r=>fixture.productRelease=r);
  if(a.p_kind==='product'&&fixture.failProducts)throw Error('Synthetic catalogue offline');
  const rows=a.p_kind==='customer'?customers:products;
  return ok({version:1,actor_id:actor,role:'co_admin',kind:a.p_kind,purpose:a.p_purpose,status:a.p_status,search:a.p_search,page:a.p_page,page_size:a.p_page_size,total_count:String(rows.length),rows:rows.slice((a.p_page-1)*a.p_page_size,a.p_page*a.p_page_size)});
 }
 if(name==='pilot_co_customer_stock_v1'){
  if(fixture.holdStock)await new Promise<void>(r=>fixture.stockRelease=r);
  return ok({version:'1',as_of:'2026-10-09T00:00:00Z',page:a.p_page,page_size:a.p_page_size,total:'0',rows:[],customer_id:a.p_customer_id,customer_version:'1',generation_id:null,stock_as_of:a.p_as_of,normalized_search:a.p_search.trim().toLowerCase(),reporting_freshness:fresh,period_start:'2026-10-01',coverage_date:'2026-10-09',summary:{opening_quantity:'0',delivered_quantity:'0',sold_quantity:'0',returned_quantity:'0',recorded_quantity:'0'}});
 }
 if(name==='pilot_co_reports_page_v2')return ok({version:'2',as_of:'2026-10-09T00:00:00Z',customer_id:a.p_customer_id,report_month:a.p_month,status:a.p_status,page:a.p_page,page_size:a.p_page_size,total:'3',rows:[1,2,3].map(i=>({id:`20000000-0000-0000-0000-${String(i).padStart(12,'0')}`,customer_id:customer,customer_name:customers[0].name,report_month:`2026-0${i+6}-01`,status:'posted',revision_id:`30000000-0000-0000-0000-${String(i).padStart(12,'0')}`,report_head_id:`20000000-0000-0000-0000-${String(i).padStart(12,'0')}`,legacy_pending:false,source_filename:`Laporan-penjualan-${i}.xlsx`,updated_at:'2026-10-09T00:00:00Z'}))});
 throw Error(`Forbidden or unhandled local fixture RPC: ${name}`);
}
export const supabase={supabaseUrl:'http://synthetic.invalid',rest:{url:'http://synthetic.invalid/rest/v1',schemaName:'public'},rpc:(name:string,a:any)=>{const result=rpc(name,a);return Object.assign(result,{abortSignal:()=>result})},from:(table:string)=>{if(table!=='customers')throw Error('Unexpected fixture table');const q:any={select:()=>q,order:()=>q,range:()=>q,abortSignal:()=>q,then:(yes:any,no:any)=>Promise.resolve({data:customers,count:customers.length,error:null}).then(yes,no)};return q;}};
