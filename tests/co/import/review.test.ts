import { describe,it,expect } from 'vitest'
import { validateReview } from '../../../src/lib/co/import/review'
import { parseQuantity } from '../../../src/lib/co/validation'
import { row,input,eligible } from './reviewFixture'
const check=(x= input(),e=eligible)=>validateReview(x,e)
const withRow=(change:Parameters<typeof row>[0])=>{const x=input();x.extracted.sourceRows=[row(change)];return x}
describe('review validation',()=>{
 it('accepts explicit eligible mapping without inventing discounts',()=>{expect(check().canConfirm).toBe(true);expect(check().quantities).toEqual([{stockKeyId:'k1',quantity:'2'}])})
 it.each([
 ['unit mismatch',()=>withRow({unit:'BOX'})],
 ['fractional source quantity',()=>withRow({quantity:{raw:'1.5',decimal:'1.5'}})],
 ['unresolved source quantity',()=>withRow({quantity:{raw:'?',decimal:null}})],
 ['unknown nonzero discount',()=>withRow({discount:{raw:'1',decimal:'1'}})],
 ['missing currency',()=>input({currency:null})],['unselected section',()=>input({includedSectionIds:[]})],
 ['incomplete',()=>input({completenessConfirmed:false})],
 ['unsafe flag',()=>withRow({flags:['unresolved_source_number']})],
 ['formula unconfirmed',()=>withRow({flags:['formula_cache_requires_confirmation']})],
 ['SKU format unconfirmed',()=>withRow({flags:['source_sku_format_requires_confirmation']})],
 ['source currency mismatch',()=>withRow({currency:'USD'})],
 ['period mismatch',()=>{const x=input();x.scope.reportMonth='2026-09-01';return x}],
 ['source identity mismatch',()=>{const x=input();x.extracted.sourceRows[0].ref.fileSha256='b'.repeat(64);return x}],
 ['unconfirmed mapping',()=>{const x=input();x.mappings[0].confirmed=false;return x}],
 ['unknown key',()=>{const x=input();x.mappings[0].stockKeyId='unknown';return x}],
 ['mapping amount differs',()=>{const x=input();x.mappings[0].quantity=parseQuantity('1');return x}],
 ] as const)('blocks %s',(_,make)=>expect(check(make()).canConfirm).toBe(false))
 it('requires exact reasoned integral conversion, never infers packs',()=>{
  const x=withRow({unit:'BOX'});x.mappings[0].quantity=parseQuantity('24');x.mappings[0].conversion={numerator:'12',denominator:'1',reason:'Verified label'}
  expect(check(x).canConfirm).toBe(true)
  x.mappings[0].conversion.reason='';expect(check(x).canConfirm).toBe(false)
  x.mappings[0].conversion={numerator:'1',denominator:'3',reason:'Verified'};expect(check(x).canConfirm).toBe(false)
 })
 it('does not resolve fractional source quantities by conversion',()=>{
 const x=withRow({unit:'BOX',quantity:{raw:'1.5',decimal:'1.5'}});x.mappings[0].conversion={numerator:'2',denominator:'1',reason:'Verified'};x.mappings[0].quantity=parseQuantity('3');expect(check(x).canConfirm).toBe(false)
 })
 it('requires specific evidence confirmation beyond SKU confirmation',()=>{
  const x=withRow({flags:['formula_cache_requires_confirmation']});
  x.sourceConfirmations=[{rowId:'r1',flag:'formula_cache_requires_confirmation',confirmed:true,reason:'Compared original evidence'}]
  expect(check(x).canConfirm).toBe(true);expect(x.extracted.sourceRows[0].flags).toEqual(['formula_cache_requires_confirmation'])
  x.sourceConfirmations[0].reason='';expect(check(x).canConfirm).toBe(false)
 })
 it('preserves duplicate source transactions and needs reason for exclusion',()=>{
  const x=input();x.extracted.sourceRows.push(row({id:'r2',ref:{...row().ref,row:'2'}}));x.extracted.sections[0].rowIds.push('r2');x.mappings.push({...x.mappings[0],rowId:'r2'})
  expect(check(x).quantities[0].quantity).toBe('4')
  x.mappings[1].included=false;expect(check(x).canConfirm).toBe(false)
  x.mappings[1].exclusionReason='Duplicate verified against original';expect(check(x).canConfirm).toBe(true)
 })
 it('distinguishes omitted SKU from expressly confirmed zero',()=>{
  const e=[...eligible,{stockKeyId:'k2',unit:'PCS',available:parseQuantity('0')}];const x=input()
  expect(check(x,e).canConfirm).toBe(false);x.omittedZeroStockKeyIds=['k2'];expect(check(x,e).quantities).toContainEqual({stockKeyId:'k2',quantity:'0'});expect(check(x,e).canConfirm).toBe(true)
 })
 it('treats linked returns as pending mandatory server verification',()=>{
  const x=withRow({returned:{raw:'73',decimal:'73'}});x.returns=[{rowId:'r1',state:'linked',links:[{returnRevisionId:'revision',quantity:parseQuantity('73')}],stockImpact:'clear',note:'Linked'}]
  expect(check(x).canConfirm).toBe(true);expect(check(x).issues).toContainEqual(expect.objectContaining({code:'return_server_verification_required',blocking:false}));expect(check(x).quantities[0].quantity).toBe('2');x.returns[0].state='unresolved';expect(check(x).canConfirm).toBe(false)
 })
 it('rejects duplicate decisions and dangling zero confirmations',()=>{const x=input();x.mappings.push({...x.mappings[0]});expect(check(x).canConfirm).toBe(false);expect(check(input({omittedZeroStockKeyIds:['unknown']})).canConfirm).toBe(false)})
 it('keeps 73/73 and 31/17 as original sold quantities and source amounts',()=>{
  for(const [q,ret,price,amount]of [['73','73','17000','1241000'],['31','17','19000','589000']]) {
   const x=withRow({quantity:{raw:q,decimal:q},returned:{raw:ret,decimal:ret},unitPrice:{raw:price,decimal:price},amount:{raw:amount,decimal:amount}});x.mappings[0].quantity=parseQuantity(q);x.returns=[{rowId:'r1',state:'linked',links:[{returnRevisionId:'revision',quantity:parseQuantity(ret)}],stockImpact:'clear',note:'Pending server verification'}];const result=check(x);expect(result.canConfirm).toBe(true);expect(result.quantities[0].quantity).toBe(q);expect(result.sourceAmount).toBe(`${amount}.00`)
  }
 })
 it('blocks contradictory selected-section printed totals',()=>{
  const x=input();x.extracted.sections[0].printedTotal={raw:'99999',decimal:'99999'}
  expect(check(x).issues).toContainEqual(expect.objectContaining({code:'section_printed_total_mismatch',blocking:true}));expect(check(x).canConfirm).toBe(false)
 })
 it('blocks a dangling section source-row identity',()=>{
  const x=input();x.extracted.sections[0].rowIds.push('missing-source-row');expect(check(x).canConfirm).toBe(false)
 })
 it('blocks duplicated and inconsistent cross-section source membership',()=>{
  const x=input();x.extracted.sections[0].rowIds.push('r1');expect(check(x).canConfirm).toBe(false)
  x.extracted.sections[0].rowIds=['r1'];x.extracted.sections.push({id:'s2',label:'Synthetic second',rowIds:['r1'],printedTotal:null});expect(check(x).canConfirm).toBe(false)
  x.extracted.sections[0].rowIds=[];expect(check(x).canConfirm).toBe(false)
 })
 it('reconciles printed totals against original rows before explicit exclusions',()=>{
  const x=input();x.extracted.sourceRows.push(row({id:'r2',ref:{...row().ref,row:'2'}}));x.extracted.sections[0].rowIds.push('r2');x.extracted.sections[0].printedTotal={raw:'129400',decimal:'129400'};x.mappings.push({...x.mappings[0],rowId:'r2',included:false,exclusionReason:'Explicit verified exclusion'});const original=JSON.stringify(x.extracted)
  const result=check(x);expect(result.canConfirm).toBe(true);expect(result.sourceAmount).toBe('64700.00');expect(result.quantities[0].quantity).toBe('2');expect(JSON.stringify(x.extracted)).toBe(original)
 })
 it('blocks unresolved provided totals and excluded covered-row amounts',()=>{
  const x=input();x.extracted.sections[0].printedTotal={raw:'?',decimal:null};expect(check(x).canConfirm).toBe(false)
  x.extracted.sections[0].printedTotal={raw:'64700',decimal:'64700'};x.extracted.sourceRows.push(row({id:'r2',ref:{...row().ref,row:'2'},amount:{raw:'?',decimal:null}}));x.extracted.sections[0].rowIds.push('r2');x.mappings.push({...x.mappings[0],rowId:'r2',included:false,exclusionReason:'Explicit exclusion'});expect(check(x).canConfirm).toBe(false)
 })
 it('accepts missing source units only through explicit manual unit confirmation',()=>{
  const x=withRow({unit:null,flags:['unit_missing','section_scope_requires_review']});expect(check(x).canConfirm).toBe(true);expect(x.extracted.sourceRows[0].unit).toBeNull();x.mappings[0].confirmed=false;expect(check(x).canConfirm).toBe(false)
 })
 it('converts return link checks to ledger units using only the explicit ratio',()=>{
  const x=withRow({unit:'BOX',returned:{raw:'1',decimal:'1'}});x.mappings[0].quantity=parseQuantity('24');x.mappings[0].conversion={numerator:'12',denominator:'1',reason:'Verified'};x.returns=[{rowId:'r1',state:'linked',links:[{returnRevisionId:'revision',quantity:parseQuantity('12')}],stockImpact:'clear',note:'Pending verification'}];expect(check(x).canConfirm).toBe(true)
 })
 it('blocks unresolved financial evidence and parser manual-review warnings',()=>{
  expect(check(withRow({amount:null})).canConfirm).toBe(false)
  const x=input();x.extracted.warnings=['manual_review:unsupported_layout'];expect(check(x).canConfirm).toBe(false)
 })
 it('validates known line discount arithmetic without return subtraction',()=>{
  const x=withRow({discount:{raw:'2000',decimal:'2000'},discountBasis:'line_amount',amount:{raw:'62700',decimal:'62700'}});expect(check(x).canConfirm).toBe(true);x.extracted.sourceRows[0].amount={raw:'64700',decimal:'64700'};expect(check(x).canConfirm).toBe(false)
 })
 it('groups by explicit eligible units without mixed-unit sum',()=>{
  const x=input();x.extracted.sourceRows.push(row({id:'r2',unit:'DOS',ref:{...row().ref,row:'2'}}));x.extracted.sections[0].rowIds.push('r2');x.mappings.push({...x.mappings[0],rowId:'r2',stockKeyId:'k2',ledgerUnit:'DOS'})
  const result=check(x,[...eligible,{stockKeyId:'k2',unit:'DOS',available:parseQuantity('10')}]);expect(result.canConfirm).toBe(true);expect(result.totalsByUnit).toEqual({PCS:'2',DOS:'2'})
 })
})

it('unresolved included exact row may request server proof, never grants local confirmation or rewrites a human choice',()=>{
 const x=withRow({returned:{raw:'1',decimal:'1'}});x.returns=[{rowId:'r1',state:'unresolved',links:[],stockImpact:'uncertain',note:'No fresh human match'}];const original=JSON.stringify(x);
 const result=check(x);expect(result.canConfirm).toBe(false);expect(result.canRequestServerCheck).toBe(true);
 expect(result.issues).toContainEqual(expect.objectContaining({code:'return_prior_coverage_check_pending',rowId:'r1',blocking:true}));expect(JSON.stringify(x)).toBe(original);expect(result.quantities[0].quantity).toBe('2');
 x.mappings[0].included=false;x.mappings[0].exclusionReason='Not this month';x.omittedZeroStockKeyIds=['k1'];expect(check(x).canRequestServerCheck).toBe(false);
 x.mappings[0].included=true;x.omittedZeroStockKeyIds=[];x.includedSectionIds=[];expect(check(x).canRequestServerCheck).toBe(false);
 x.includedSectionIds=['s1'];x.returns[0].stockImpact='clear';expect(check(x).canRequestServerCheck).toBe(false);
});
