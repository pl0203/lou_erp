import {test,expect} from 'vitest';
import {classifyCORecovery,hasScopedCORecovery,scopedCORecoveryKeys} from '../../../src/lib/co/import/recoveryScope';
const actor='11111111-1111-1111-1111-111111111111',customer='22222222-2222-2222-2222-222222222222',id='33333333-3333-3333-3333-333333333333',scope='report:2026-09-01';
const key=scopedCORecoveryKeys(actor,customer,scope)[3];
const binding={family:'commit',customerId:customer,month:'2026-09-01',operation:'correct_report',binding:{importId:id,importVersion:'1',customerVersion:'1',draftId:id,draftVersion:'2',manifestDigest:'b'.repeat(64)}};
const classify=(v:unknown)=>classifyCORecovery(JSON.stringify(v),key,actor,customer,scope);
test('F4 certain refusal is not recoverable; unknown/receipts/malformed remain blocking without deletion',()=>{const base={id,key:'a'.repeat(64),uncertain:false,binding};expect(classify(base)).toBe('certain_refusal');expect(classify({...base,uncertain:true})).toBe('unknown');expect(classify({...base,committed:{}})).toBe('committed');for(const bad of [{...base,binding:{}},{...base,binding:{...binding,customerId:actor}},{...base,uncertain:'false'},{...base,extra:true},{...base,binding:{...binding,operation:'invented'}},{}])expect(classify(bad)).toBe('malformed');expect(classifyCORecovery(null,key,actor,customer,scope)).toBe('absent')});
