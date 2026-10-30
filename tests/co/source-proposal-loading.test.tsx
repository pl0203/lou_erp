import React from 'react';
import {act,fireEvent,screen,waitFor} from '@testing-library/react';
import {expect,test} from 'vitest';
import {store,mount,customer,month,id,draftId,hash,wire} from './report-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
import {createCOTransactionSender} from '../../src/lib/co/transactions';
const sourceRPC='pilot_co_report_source_proposal_v1';
const route=`/athel/co/reports/${customer}/${month}?proposalDraft=${id(30)}&proposalMonth=${month}&proposalDraftVersion=1&proposalCustomerVersion=1`;
function fixture(){
 const s=store();s.rows[0].sold_quantity='7';s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'1',eligible_set_fingerprint:null,revenue:'70000'};
 const proposal={version:'1',customer_id:customer,report_month:month,draft_id:id(30),draft_version:'1',customer_version:'1',source_context:{operation:'correct_report',payload:{expected_customer_version:'1',reason:'Original source',draft_id:draftId,expected_draft_version:'1',report_head_id:id(4),original_revision_id:id(5),expected_report_version:'1',eligible_set_fingerprint:hash},source_context_fingerprint:'c'.repeat(64)},owner:{kind:'report',co_id:null,report_month:month}};
 const control:{fail:null|((n:string,a:any)=>any)}={fail:null};
 wire.handler=async(n:string,a:any)=>{const failed=await control.fail?.(n,a);if(failed)return failed;return n===sourceRPC?{data:structuredClone(proposal),error:null}:s.handle(n,a)};
 return {s,proposal,control};
}
async function reason(){const field=await screen.findByLabelText('Alasan perubahan');await waitFor(()=>expect(screen.getByRole('button',{name:'Tinjau semua dampak'}).matches(':disabled')).toBe(false));return field;}
test.each(['08006','42501'])('source proposal first pending then %s error never creates a replacement editor',async code=>{
 const {s,control}=fixture();let release!:()=>void;const pending=new Promise<void>(r=>release=r);
 control.fail=async n=>{if(n===sourceRPC){await pending;return {data:null,error:{code,message:'Proposal unavailable'}}}return null};
 mount(<COMonthlyReport/>,route);await screen.findByText('Memeriksa usulan sumber asli…');expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();
 await act(async()=>release());await screen.findAllByText('Proposal unavailable');expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();expect(screen.queryByText('Memeriksa usulan sumber asli…')).toBeNull();expect(s.commands).toHaveLength(0);
});
test.each(['transport','fingerprint'])('retained immutable source reason survives %s failure locked without replacing its owner',async mode=>{
 const {s,proposal,control}=fixture();const {client}=mount(<COMonthlyReport/>,route);const field=await reason();expect((field as HTMLTextAreaElement).value).toBe('Original source');expect(field.matches(':disabled')).toBe(true);
 if(mode==='transport')control.fail=n=>n===sourceRPC?{data:null,error:{code:'08006',message:'Proposal refresh offline'}}:null;
 else proposal.source_context.source_context_fingerprint='d'.repeat(64);
 await act(async()=>{await client.invalidateQueries({predicate:q=>q.queryKey[4]==='source-proposal'});});
 await screen.findAllByText(mode==='transport'?'Proposal refresh offline':/sumber berubah; isian dan hasil asli dipertahankan/);
 expect(screen.getByDisplayValue('Original source')).toBe(field);expect(field.matches(':disabled')).toBe(true);
 const inspect=screen.getByRole('button',{name:'Tinjau semua dampak'});expect(inspect.matches(':disabled')).toBe(true);fireEvent.click(inspect);expect(s.commands).toHaveLength(0);
});
test('source proposal authority denial clears previously mounted source fields and private cache',async()=>{
 const {s,control}=fixture();const {client}=mount(<COMonthlyReport/>,route);await reason();expect(screen.getByDisplayValue('Original source')).toBeTruthy();
 control.fail=n=>n===sourceRPC?{data:null,error:{code:'42501',message:'Proposal authority revoked'}}:null;
 await act(async()=>{await client.invalidateQueries({predicate:q=>q.queryKey[4]==='source-proposal'});});await screen.findAllByText('Proposal authority revoked');
 expect(screen.queryByDisplayValue('Original source')).toBeNull();expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();expect(client.getQueryCache().getAll().filter(q=>q.queryKey[0]==='co'&&q.state.data)).toHaveLength(0);expect(s.commands).toHaveLength(0);
});
test.each(['draft','head'])('source proposal wrong initial %s version cannot mount review',async target=>{
 const {s,proposal}=fixture();if(target==='draft')proposal.source_context.payload.expected_draft_version='2';else proposal.source_context.payload.expected_report_version='2';
 mount(<COMonthlyReport/>,route);await screen.findByText('Usulan sumber asli tidak tersedia: laporan utama berubah.');expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();expect(s.commands).toHaveLength(0);
});
test('source report actor loss removes original source fields without dispatch',async()=>{
 const {s}=fixture();const {router}=mount(<COMonthlyReport/>,route);await reason();expect(screen.getByDisplayValue('Original source')).toBeTruthy();
 wire.actor=false;await act(async()=>{await router.navigate(route+'&changed=1');});await waitFor(()=>expect(screen.queryByDisplayValue('Original source')).toBeNull());expect(s.commands).toHaveLength(0);
});
test.each(['unknown','committed'])('real retained %s correction selects recovery before proposal read and never resends',async outcome=>{
 const {s}=fixture();let lost=false;const base=wire.handler;
 wire.handler=async(n:string,a:any)=>{const result=await base(n,a);if(n==='pilot_co_transaction_v1'&&outcome==='unknown'&&!lost){lost=true;return {data:null,error:{code:'08006',message:'Reply lost'}}}return result};
 const sender=createCOTransactionSender({actorId:id(1),role:'co_admin',scope:`report:${month}`,customerId:customer,storage:()=>localStorage,retainCommitted:true});
 const sending=sender('correct_report',{customer_id:customer,report_month:month,report_head_id:id(4),original_revision_id:id(5),expected_report_version:'1',draft_id:draftId,expected_draft_version:'1',expected_customer_version:'1',reason:'Original correction'});
 if(outcome==='unknown')await expect(sending).rejects.toThrow('Reply lost');else await sending;
 const key=Object.keys(localStorage).find(k=>k.startsWith('co-request:'))!;expect(key).toBeTruthy();const retained=localStorage.getItem(key);
 mount(<COMonthlyReport/>,route);await screen.findByRole('region',{name:'Pemulihan koreksi laporan'});
 expect(wire.rpc.mock.calls.filter(([n])=>n===sourceRPC)).toHaveLength(0);expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();expect(s.commands).toHaveLength(1);expect(localStorage.getItem(key)).toBe(retained);
});

test.each(['08006','42501'])('report source root pending then %s shows failure rather than endless accepted-data loading',async code=>{
 const {s,control}=fixture();let release!:()=>void;const pending=new Promise<void>(r=>release=r);
 control.fail=async n=>{if(n==='pilot_co_report_v1'){await pending;return {data:null,error:{code,message:'Report root unavailable'}}}return null};
 mount(<COMonthlyReport/>,route);await screen.findByText('Memuat sumber laporan…');expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();
 await act(async()=>release());await screen.findAllByText('Report root unavailable');expect(screen.queryByText('Memuat sumber laporan…')).toBeNull();expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();expect(s.commands).toHaveLength(0);
});

test('initial report root transport retry is read-only and restores only the original checked source',async()=>{
 const {s,control}=fixture();control.fail=n=>n==='pilot_co_report_v1'?{data:null,error:{code:'08006',message:'Retry root offline'}}:null;
 mount(<COMonthlyReport/>,route);await screen.findByText('Retry root offline');expect(s.commands).toHaveLength(0);
 let release!:()=>void;const pending=new Promise<void>(r=>release=r);control.fail=async n=>{if(n==='pilot_co_report_v1')await pending;return null};
 fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));await screen.findByText('Memuat sumber laporan…');expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();expect(s.commands).toHaveLength(0);
 await act(async()=>release());
 expect((await reason() as HTMLTextAreaElement).value).toBe('Original source');expect(s.commands).toHaveLength(0);
 expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_transaction_v1')).toHaveLength(0);
});
test('departed actor cannot mount source review from late initial-root retry',async()=>{
 const {s,control}=fixture();control.fail=n=>n==='pilot_co_report_v1'?{data:null,error:{code:'08006',message:'Late retry root offline'}}:null;
 const {router}=mount(<COMonthlyReport/>,route);await screen.findByText('Late retry root offline');
 let release!:()=>void;const pending=new Promise<void>(r=>release=r);control.fail=async n=>{if(n==='pilot_co_report_v1')await pending;return null};
 fireEvent.click(screen.getByRole('button',{name:'Coba lagi'}));await waitFor(()=>expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_report_v1')).toHaveLength(2));
 wire.actor=false;await act(async()=>{await router.navigate(route+'&left=1');});await act(async()=>release());
 expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();expect(screen.queryByText('Memuat sumber laporan…')).toBeNull();expect(s.commands).toHaveLength(0);
});
