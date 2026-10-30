// @vitest-environment node
import { beforeAll, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extractXlsx } from '../../src/lib/co/import/xlsx';
import { validateReview } from '../../src/lib/co/import/review';
import type { ExtractedReport, ReviewInput } from '../../src/lib/co/import/types';
const sha='30f1236ea3c9a83314154423ea4e98146a1a579d790888d4c977a97352581b6a';
const stockKey='dd7c3049-8e6c-4cb3-949a-6a5f81519cc5';
let extracted:ExtractedReport;
beforeAll(async()=>{
 const bytes=readFileSync(new URL('./fixtures/accepted-monthly-20261029.xlsx',import.meta.url));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha);
 extracted=await extractXlsx(new Uint8Array(bytes),sha,new AbortController().signal);
});
function reviewed():ReviewInput{return {
 scope:{actorId:'00000000-0000-0000-0000-000000000001',customerId:'c080573d-ebcc-4dda-964e-40c605cd2290',reportMonth:'2026-10-01',epoch:0},extracted,
 mappings:extracted.sourceRows.map(r=>({rowId:r.id,stockKeyId:stockKey,ledgerUnit:'test unit',quantity:'1',conversion:null,included:true,exclusionReason:null,confirmed:true})),
 returns:extracted.sourceRows.map(r=>({rowId:r.id,state:'none',links:[],stockImpact:'clear',note:'Source explicitly reports zero returns'})),
 includedSectionIds:extracted.sections.map(s=>s.id),completenessConfirmed:true,omittedZeroStockKeyIds:[],currency:'IDR',reason:null,
};}
const eligible=[{stockKeyId:stockKey,unit:'test unit',available:'1'}];
test('exact accepted XLSX parses through real guarded parser, not a mocked extraction',()=>{
 expect(extracted.sourceRows).toHaveLength(1);
 expect(extracted.warnings.some(w=>w.startsWith('manual_review:'))).toBe(false);
 expect(extracted.sourceRows[0]).toMatchObject({quantity:{decimal:'1'},returned:{decimal:'0'},unitPrice:{decimal:'10000'},amount:{decimal:'10000'}});
});
test('accepted row requires explicit mapping, currency and completeness before readiness',()=>{
 const input=reviewed();const result=validateReview(input,eligible);
 expect(result.issues).toEqual([]);expect(result.canConfirm).toBe(true);
 for(const patch of [{currency:null},{completenessConfirmed:false},{mappings:[]},{mappings:input.mappings.map(m=>({...m,confirmed:false}))},{mappings:input.mappings.map(m=>({...m,ledgerUnit:null}))}]){
  expect(validateReview({...input,...patch},eligible).canConfirm).toBe(false);
 }
 expect(result.sourceAmount).toBe('10000.00');
 expect(result.quantities).toEqual([{stockKeyId:stockKey,quantity:'1'}]);
 expect(input.returns).toEqual([{rowId:extracted.sourceRows[0].id,state:'none',links:[],stockImpact:'clear',note:'Source explicitly reports zero returns'}]);
});
test('omitted eligible SKU is not silently converted into zero',()=>{
 const result=validateReview(reviewed(),[...eligible,{stockKeyId:'00000000-0000-0000-0000-000000000099',unit:'test unit',available:'1'}]);
 expect(result.canConfirm).toBe(false);
 expect(result.quantities).not.toContainEqual({stockKeyId:'00000000-0000-0000-0000-000000000099',quantity:'0'});
});
