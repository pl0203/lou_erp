import { expect, test } from 'vitest'
import type { Customer, Product, ReviewDecision } from '../src/lib/poImport/contracts'
import { matchPODraft } from '../src/lib/poImport/matching'
import { parsePODocument } from '../src/lib/poImport/parse'
import { isFinancialReviewIssue, preparePOFormDraft } from '../src/lib/poImport/review'
import { validateOrderLines } from '../src/lib/orderValidation'
import { depotTable, photoGrid, pricedIndent, token, unpricedIndent } from './fixtures/po-import-layouts'
const customers: Customer[]=[{id:'buyer',name:'PT. LANTERN RETAIL GROUP',pricing_tier:'luar_kota'},{id:'vendor',name:'GLASS PINE SUPPLY',pricing_tier:'dalam_kota'}]
const makeProduct=(id:string,sku:string,name:string):Product=>({id,sku,name,size:null,harga_pokok:0,luar_kota:120000,dalam_kota:null,depo_bangunan:130000})
function ready(input=pricedIndent()) {
 const parsed=parsePODocument(input)
 const catalog=parsed.rows.map((r,i)=>({...makeProduct(`product-${i}`,r.sku.value||`ERP-${i}`,r.name.value!),luar_kota:r.unitPrice.value===null?120000:Number(r.unitPrice.value)}))
 const cs=[{...customers[0],name:parsed.buyer.value!},customers[1]]
 const decision:ReviewDecision={customerId:'buyer',poNumber:parsed.poNumber.value!,orderDate:parsed.orderDate.value!||'2028-04-11',expiry:'',notes:parsed.notes,idrConfirmed:true,acknowledgedIssueIds:parsed.issues.filter(i=>!i.blocking).map(i=>i.id),rows:Object.fromEntries(parsed.rows.map((r,i)=>[r.id,{productId:catalog[i].id,manual:false,sku:catalog[i].sku,name:catalog[i].name,quantity:r.quantity.value || '1',unitPrice:r.unitPrice.value,unitConfirmed:true}]))}
 decision.acknowledgedIssueIds.push(...preparePOFormDraft(parsed,decision,cs,catalog).issues.filter(isFinancialReviewIssue).map(i=>i.id))
 return {parsed,catalog,cs,decision,run:()=>preparePOFormDraft(parsed,decision,cs,catalog)}
}
test('buyer exact matching ignores supplier and never treats vendor code as ERP customer ID',()=>{
 const x=ready();expect(matchPODraft(x.parsed,x.cs,x.catalog).customerIds).toEqual(['buyer'])
 x.parsed.buyer.value='V-00999';expect(matchPODraft(x.parsed,x.cs,x.catalog).customerIds).toEqual([])
})
test('only names collapse whitespace; SKU punctuation and leading zeros are significant',()=>{
 const x=ready();x.parsed.rows[0].sku.value=' ab-001 ';x.parsed.rows[0].name.value=' GLASS   BLUE '
 const products=[makeProduct('exact','AB-001','unrelated'),makeProduct('punctuation','AB001','unrelated'),makeProduct('zero','AB-1','unrelated'),makeProduct('name','X','glass blue')]
 expect(matchPODraft(x.parsed,x.cs,products).productIdsByRow[x.parsed.rows[0].id]).toEqual(['exact','name'])
})
test('exact customer/product collisions remain multiple candidates for review',()=>{
 const x=ready();expect(matchPODraft(x.parsed,[...x.cs,{...x.cs[0],id:'collision'}],[...x.catalog,{...x.catalog[0],id:'collision'}])).toMatchObject({customerIds:['buyer','collision'],productIdsByRow:{[x.parsed.rows[0].id]:['product-0','collision']}})
})
test('barcode evidence cannot automatically identify a catalog product',()=>{
 const x=ready(unpricedIndent());const products=[makeProduct('bar',x.parsed.rows[0].barcode.value!,'different')]
 expect(matchPODraft(x.parsed,x.cs,products).productIdsByRow[x.parsed.rows[0].id]).toEqual([])
})
test('unresolved buyer prevents applying',()=>{
 const x=ready();x.decision.customerId='';expect(x.run().draft).toBeNull()
})
test('current authorized customer and product arrays revalidate previously chosen IDs',()=>{
 const x=ready();x.cs.splice(0,1);expect(x.run().draft).toBeNull()
 const y=ready();y.catalog.splice(0,1);expect(y.run().draft).toBeNull()
})
test('stale catalog name or SKU cannot be silently substituted',()=>{
 const x=ready();x.catalog[0].sku='NEW-SKU';expect(x.run().draft).toBeNull()
 const y=ready();y.catalog[0].name='Renamed catalog item';expect(y.run().draft).toBeNull()
})
test('explicitly reviewed source prices persist and current catalog differences are warnings',()=>{
 const x=ready();x.catalog[0].luar_kota=98765;expect(x.run().draft).toBeNull();acknowledgeFinance(x);const result=x.run();expect(result.draft!.lineItems[0].unit_price).toBe(120000);expect(result.issues.some(i=>i.code==='catalog-price-difference')).toBe(true)
})
test('missing selected-tier catalog price never substitutes a different tier',()=>{
 const x=ready();x.cs[0].pricing_tier='dalam_kota';expect(x.run().draft).toBeNull();acknowledgeFinance(x);const result=x.run();expect(result.draft!.lineItems[0].unit_price).toBe(120000);expect(result.issues.some(i=>i.code==='catalog-price-missing')).toBe(true)
})
test('acknowledged blank price applies NaN, and ordinary Save validation still rejects it',()=>{
 const x=ready(unpricedIndent());const first=x.parsed.rows[0]
 x.decision.acknowledgedIssueIds.push(...x.parsed.rows.flatMap(r=>r.issues.filter(i=>i.code==='missing-price').map(i=>i.id)))
 const result=x.run();expect(result.draft).not.toBeNull();expect(result.draft!.lineItems[0].unit_price).toBeNaN();expect(result.issues.some(i=>i.field===`rows.${first.id}.unitPrice` && i.code==='missing-price')).toBe(true)
 expect(()=>validateOrderLines(result.draft!.lineItems)).toThrow()
})
test('blank price requires explicit missing-price acknowledgement even when catalog has price',()=>{
 const x=ready();x.decision.rows[x.parsed.rows[0].id].unitPrice=null;expect(x.run().draft).toBeNull()
 x.decision.acknowledgedIssueIds.push(`${x.parsed.rows[0].id}:missing-price`);acknowledgeFinance(x);expect(x.run().draft!.lineItems[0].unit_price).toBeNaN()
})
test('explicit zero requires confirmation and is preserved as zero',()=>{
 const x=ready();x.decision.rows[x.parsed.rows[0].id].unitPrice='0';expect(x.run().draft).toBeNull()
 x.decision.acknowledgedIssueIds.push(`${x.parsed.rows[0].id}:zero-price`);acknowledgeFinance(x);expect(x.run().draft!.lineItems[0].unit_price).toBe(0)
})
test('zero selected-tier catalog value remains valid and is never considered missing',()=>{
 const x=ready();x.cs[0].pricing_tier='harga_pokok';x.decision.rows[x.parsed.rows[0].id].unitPrice='0';x.decision.acknowledgedIssueIds.push(`${x.parsed.rows[0].id}:zero-price`)
 expect(x.run().issues.some(i=>i.field===`rows.${x.parsed.rows[0].id}.unitPrice` && i.code==='catalog-price-missing')).toBe(false)
})
test('manual row is explicit, retains user reviewed name and SKU, and needs no catalog creation',()=>{
 const x=ready();x.decision.rows[x.parsed.rows[0].id]={productId:null,manual:true,sku:'MANUAL-007',name:'User reviewed trim',quantity:'3',unitPrice:'12.34',unitConfirmed:true}
 acknowledgeFinance(x);const result=x.run();expect(result.draft!.lineItems[0]).toMatchObject({product_id:null,sku:'MANUAL-007',product_name:'User reviewed trim',quantity:3,unit_price:12.34})
})
test('missing product mapping cannot become an implicit manual row',()=>{
 const x=ready();x.decision.rows[x.parsed.rows[0].id].productId=null;expect(x.run().draft).toBeNull()
})
test('manual plus product ID is contradictory and blocked',()=>{
 const x=ready();x.decision.rows[x.parsed.rows[0].id].manual=true;expect(x.run().draft).toBeNull()
})
test('each source row requires a reviewed row without deleting or adding rows',()=>{
 const x=ready();delete x.decision.rows[x.parsed.rows[0].id];expect(x.run().draft).toBeNull()
 const y=ready();y.decision.rows.extra={...Object.values(y.decision.rows)[0]};expect(y.run().draft).toBeNull()
})
test('duplicate source SKUs map to distinct draft lines rather than merge',()=>{
 const x=ready();x.catalog[1].sku=x.catalog[0].sku;x.decision.rows[x.parsed.rows[1].id].sku=x.catalog[0].sku
 acknowledgeFinance(x);const result=x.run();expect(result.draft!.lineItems).toHaveLength(2);expect(result.draft!.lineItems[0]._key).not.toBe(result.draft!.lineItems[1]._key)
})
test('reviewed positive integer quantity required; no fractional or unit conversion',()=>{
 for(const raw of ['1.5','0','-1','NaN','1e3','9007199254740992']){const x=ready();x.decision.rows[x.parsed.rows[0].id].quantity=raw;expect(x.run().draft).toBeNull()}
 const x=ready();x.decision.rows[x.parsed.rows[0].id].unitConfirmed=false;expect(x.run().draft).toBeNull()
})
test('reviewed money stays canonical and honors existing precision and maximum rules',()=>{
 for(const raw of ['-1','1e3','1,234','12.001','Infinity','1000000000000']){const x=ready();x.decision.rows[x.parsed.rows[0].id].unitPrice=raw;expect(x.run().draft).toBeNull()}
})
test('implicit currency needs explicit IDR confirmation; foreign source blocks conversion',()=>{
 const x=ready();x.decision.idrConfirmed=false;expect(x.run().draft).toBeNull()
 x.parsed.currency={raw:'USD',value:'USD',page:1};x.decision.idrConfirmed=true;expect(x.run().draft).toBeNull()
})
test('expiry maps only to expectedDelivery, never to payment terms or delivery date',()=>{
 const x=ready(photoGrid());x.decision.expiry='2028-01-20';expect(x.run().draft!.expectedDelivery).toBe('2028-01-20')
 x.decision.expiry='';expect(x.run().draft!.expectedDelivery).toBe('')
})
test('valid explicit reviewed date resolves source absence but impossible dates block',()=>{
 const x=ready();x.decision.orderDate='2028-02-31';expect(x.run().draft).toBeNull()
 x.decision.orderDate='2028-02-29';expect(x.run().draft).not.toBeNull()
 x.decision.expiry='2028-13-01';expect(x.run().draft).toBeNull()
})
test('persistent source blockers cannot be dismissed via acknowledgement',()=>{
 const x=ready();x.parsed.complete=false;x.parsed.issues.push({id:'incomplete-extraction',field:'document',code:'incomplete-extraction',message:'Incomplete',blocking:true});x.decision.acknowledgedIssueIds.push('incomplete-extraction');expect(x.run().draft).toBeNull()
})
test('fractional source uncertainty can be resolved only by explicit valid reviewed quantity',()=>{
 const x=ready();x.parsed.rows[0].quantity.value='1.5';x.parsed.rows[0].issues.push({id:'fractional',field:`rows.${x.parsed.rows[0].id}.quantity`,code:'fractional-quantity',message:'Review',blocking:true})
 x.decision.rows[x.parsed.rows[0].id].quantity='2';acknowledgeFinance(x);expect(x.run().draft!.lineItems[0].quantity).toBe(2)
})
test('a future or unsupported layout cannot apply merely by claiming complete',()=>{
 const x=ready();x.parsed.layout='unknown-layout';expect(x.run().draft).toBeNull()
})
test('unknown blocking source row issues cannot be acknowledged away',()=>{
 const x=ready();const id=`${x.parsed.rows[0].id}:source-integrity`;x.parsed.rows[0].issues.push({id,field:`rows.${x.parsed.rows[0].id}.source`,code:'source-integrity',message:'Unsafe row',blocking:true});x.decision.acknowledgedIssueIds.push(id);expect(x.run().draft).toBeNull()
})
test('coincidental exact buyer source code is a suggestion without ERP identity provenance',()=>{
 const x=ready();const row=x.parsed.rows[0]
 expect(matchPODraft(x.parsed,x.cs,x.catalog).productIdsByRow[row.id]).toEqual(['product-0'])
 expect(row.issues.some(i=>i.code==='source-sku-review' && !i.blocking)).toBe(true)
 x.decision.rows[row.id].productId=null;expect(x.run().draft).toBeNull()
 x.decision.rows[row.id].productId=x.catalog[0].id;expect(x.run().draft).not.toBeNull()
})
test('barcode-only buyer document also labels source code evidence as unproven',()=>{
 const x=ready(unpricedIndent());expect(x.parsed.rows.every(r=>r.sku.value===null && r.issues.some(i=>i.code==='source-sku-review'))).toBe(true)
})
test('foreign price-column evidence blocks an IDR-confirmed reviewed draft',()=>{
 const input=pricedIndent();input[0].tokens.find(t=>t.text==='Harga')!.text='Harga (USD)'
 const x=ready(input);expect(x.decision.idrConfirmed).toBe(true);expect(x.run().draft).toBeNull()
})
test('a lost photo item cannot be applied by correcting merged fields and acknowledging all issues',()=>{
 const input=photoGrid();input[0].tokens=input[0].tokens.filter(t=>!((t.text==='3' && t.x===108) || t.text==='000710003' || t.text==='880010003'))
 const x=ready(input);for(const row of Object.values(x.decision.rows)){row.quantity='1000';row.unitPrice='5000'}
 x.decision.acknowledgedIssueIds.push(...x.run().issues.map(i=>i.id));expect(x.run().draft).toBeNull()
})
test.each([
 ['mixed model',[token('MODEL',590,350,60,18,98),token('900',670,350,30,18,98),token('WHITE',730,350,60,18,98)],'MODEL 900 WHITE'],
 ['indented text',[token('WRAPPED DESCRIPTION TAIL',710,350,350,18,98)],'WRAPPED DESCRIPTION TAIL'],
] as const)('reviewed photo Apply conserves %s source continuation',(_label,tokens,continuation)=>{
 const input=photoGrid();input[0].tokens.push(...tokens);const x=ready(input);const result=x.run()
 expect(result.draft).not.toBeNull();expect(result.draft!.lineItems[0].product_name).toContain(continuation);expect(x.parsed.rows[0].name.raw).toContain(continuation)
})
test('uncertain photo continuation cannot apply after valid edits and acknowledgement of every issue',()=>{
 const input=photoGrid();input[0].tokens.push(token('900',710,350,30,18,98));const x=ready(input)
 x.decision.acknowledgedIssueIds.push(...x.run().issues.map(i=>i.id));expect(x.run().draft).toBeNull()
})
test('reviewed Apply retains mixed continuation spanning the alternate-quantity column',()=>{
 const input=photoGrid();input[0].tokens.push(token('MODEL',950,365,60,18,98),token('900',1050,365,30,18,98),token('WHITE',1100,365,60,18,98))
 const x=ready(input);const result=x.run();expect(result.draft).not.toBeNull();expect(result.draft!.lineItems[0].product_name).toContain('MODEL 900 WHITE')
})
test.each([[1050,365],[1080,375],[1050,350]] as const)('numeric-only overlap is non-dismissible despite valid review (%s/%s)',(x,y)=>{
 const input=photoGrid();input[0].tokens.push(token('900',x,y,30,18,98));const state=ready(input)
 state.decision.acknowledgedIssueIds.push(...state.run().issues.map(i=>i.id));expect(state.run().draft).toBeNull()
})
const financialCodes=['tax-review','total-mismatch','line-total-mismatch','catalog-price-difference','catalog-price-missing','unsupported-charge']
const acknowledgeFinance=(x:ReturnType<typeof ready>)=>x.decision.acknowledgedIssueIds.push(...x.run().issues.filter(i=>financialCodes.includes(i.code)).map(i=>i.id))
test('source tax and total differences require meaningful financial acknowledgement',()=>{
 const input=pricedIndent();input[0].tokens.find(t=>t.text==='Jumlah Bersih : 1,300,000')!.text='Jumlah Bersih : 1,300,001'
 const x=ready(input);x.decision.acknowledgedIssueIds=[];const result=x.run()
 expect(result.draft).toBeNull();expect(result.issues.filter(i=>['tax-review','total-mismatch'].includes(i.code)).every(i=>i.blocking)).toBe(true)
 acknowledgeFinance(x);expect(x.run().draft).not.toBeNull()
})
test('new catalog warning must be shown and acknowledged before Apply',()=>{
 const x=ready();x.catalog[0].luar_kota=98765;const result=x.run();const warning=result.issues.find(i=>i.code==='catalog-price-difference')!
 expect(result.draft).toBeNull();expect(warning.blocking).toBe(true)
 acknowledgeFinance(x);expect(x.run().draft!.lineItems[0].unit_price).toBe(120000)
})
test('financial acknowledgement is bound to the current catalog amounts and customer tier',()=>{
 const x=ready();acknowledgeFinance(x);expect(x.run().draft).not.toBeNull()
 const oldIds=[...x.decision.acknowledgedIssueIds];x.catalog[0].luar_kota=98765;const newIds=x.run().issues.filter(i=>financialCodes.includes(i.code)).map(i=>i.id)
 expect(x.run().draft).toBeNull();expect(newIds.some(id=>!oldIds.includes(id))).toBe(true)
 acknowledgeFinance(x);expect(x.run().draft).not.toBeNull();x.cs[0].pricing_tier='dalam_kota';expect(x.run().draft).toBeNull()
})
test('reviewed quantities recompute total warnings and invalidate prior financial acknowledgement',()=>{
 const x=ready();acknowledgeFinance(x);expect(x.run().draft).not.toBeNull()
 x.decision.rows[x.parsed.rows[0].id].quantity='9';const result=x.run();expect(result.draft).toBeNull();expect(result.issues.some(i=>i.code==='total-mismatch' && i.blocking)).toBe(true)
 acknowledgeFinance(x);expect(x.run().draft!.lineItems[0].quantity).toBe(9)
})
test('unsupported charge is visible, acknowledged explicitly, and does not change line prices',()=>{
 const input=depotTable();input[1].tokens.push({text:'Transportation Cost : 100.00',x:360,y:580,width:210,height:15,confidence:null})
 const x=ready(input);x.decision.acknowledgedIssueIds=[];expect(x.run().draft).toBeNull();expect(x.run().issues.some(i=>i.code==='unsupported-charge' && i.blocking)).toBe(true)
 acknowledgeFinance(x);const result=x.run();expect(result.draft).not.toBeNull();expect(result.draft!.lineItems[0].unit_price).toBe(1200);expect(result.draft!.notes).toContain('Transportation Cost : 100.00')
})
