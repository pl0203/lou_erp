import {describe,test,expect} from 'vitest';
import {legacyReturnState,assertNoLegacyReturn,legacyReturnCustomers} from '../../src/lib/co/returnLegacyRecovery';
const actor='00000000-0000-0000-0000-000000000001',customer='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003',request='00000000-0000-0000-0000-000000000004';
const backend='https://example.invalid';
const key=(a=actor,c=customer,b=backend)=>`co-request:${encodeURIComponent(b)}:${a}:${c}:return`;
const raw=(patch={})=>JSON.stringify({id:request,key:'a'.repeat(64),uncertain:true,binding:{operation:'post_return',customer_id:customer},...patch});
function store(entries:Record<string,string>={}){const map=new Map(Object.entries(entries));const reads:string[]=[];return {reads,get length(){return map.size},key:(i:number)=>[...map.keys()][i]??null,getItem:(k:string)=>{reads.push(k);return map.get(k)??null}}}
describe('legacy return ownership gate',()=>{
 test('absent/refused do not block; uncertain or committed do',()=>{
  expect(legacyReturnState(store(),actor,customer,backend)).toBe('absent');
  const refused=store({[key()]:raw({uncertain:false})});expect(legacyReturnState(refused,actor,customer,backend)).toBe('refused');expect(()=>assertNoLegacyReturn(refused,actor,customer,backend)).not.toThrow();
  expect(legacyReturnState(store({[key()]:raw()}),actor,customer,backend)).toBe('pending');
  const committed={id:other,operation:'post_return',version:'1',customer_id:customer,customer_version:'2'};
  expect(legacyReturnState(store({[key()]:raw({uncertain:false,committed})}),actor,customer,backend)).toBe('pending');
  expect(()=>assertNoLegacyReturn(store({[key()]:raw()}),actor,customer,backend)).toThrow(/retur lama/i);
 });
 test.each(['not json','null','{}',raw({id:'bad'}),raw({key:'bad'}),raw({uncertain:'false'}),raw({unknown:true}),raw({binding:{operation:'post_report',customer_id:customer}}),raw({binding:{operation:['post_return'],customer_id:customer}}),raw({binding:{operation:'post_return',customer_id:other}}),raw({binding:{operation:'post_return',customer_id:customer,draft_id:'bad'}}),raw({committed:{id:other,operation:'post_return',version:'1',customer_id:other,customer_version:'2'}})])('malformed payload blocks (%s)',value=>{
  const s=store({[key()]:value});expect(legacyReturnState(s,actor,customer,backend)).toBe('malformed');expect(()=>assertNoLegacyReturn(s,actor,customer,backend)).toThrow();
 });
 test('receipt operation and known target remain bound',()=>{
  for(const op of ['save_return_draft','correct_return']){
   const binding={operation:op,customer_id:customer,target_id:other};const committed={id:request,operation:op,customer_id:customer,version:'1',customer_version:'2'};
   expect(legacyReturnState(store({[key()]:raw({binding,committed})}),actor,customer,backend)).toBe('malformed');
  }
  expect(legacyReturnState(store({[key()]:raw({binding:{operation:'save_return_draft',customer_id:customer,draft_id:other},committed:{id:other,operation:'save_return_draft',version:'1',customer_id:customer,customer_version:'2'}})}),actor,customer,backend)).toBe('pending');
 });
 test('enumeration reads only exact actor/backend/legacy-return keys',()=>{
  const s=store({[key()]:raw(),[key(other)]:raw(),[key(actor,customer,'other')]:raw(),[key()+':extra']:'bad',[key().replace(':return',':monthly:2026-10')]:'bad',['co-return-workspace:new']:'bad',[key(actor,other)]:raw({binding:{operation:'save_return_draft',customer_id:other},uncertain:false})});
  expect(legacyReturnCustomers(s,actor,backend)).toEqual([{customerId:customer,state:'pending'}]);expect(s.reads.sort()).toEqual([key(),key(actor,other)].sort());
 });
 test('unknown matching customer identity and storage failures fail closed without writes',()=>{
  expect(()=>legacyReturnCustomers(store({[key(actor,'bad')]:raw()}),actor,backend)).toThrow();
  expect(legacyReturnState({getItem(){throw Error('blocked')}},actor,customer,backend)).toBe('malformed');
  expect(()=>legacyReturnCustomers({get length(){throw Error('blocked')},key:()=>null,getItem:()=>null},actor,backend)).toThrow();
  expect(()=>legacyReturnCustomers({length:1,key(){throw Error('blocked')},getItem:()=>null},actor,backend)).toThrow();
 });
});
test('scanner preserves malformed pending evidence and never touches unknown scopes',()=>{
 const s=store({[key()]:'broken',[key().replace(':return',':report:2026-01')]:'broken'});
 expect(legacyReturnCustomers(s,actor,backend)).toEqual([{customerId:customer,state:'malformed'}]);expect(s.reads).toEqual([key()]);
 const denied={length:1,key:()=>key(),getItem:()=>{throw Error('read denied')}};
 expect(legacyReturnCustomers(denied,actor,backend)).toEqual([{customerId:customer,state:'malformed'}]);
 expect(()=>legacyReturnCustomers({length:-1,key:()=>null,getItem:()=>null},actor,backend)).toThrow();
});
