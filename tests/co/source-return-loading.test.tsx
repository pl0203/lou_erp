import React from 'react';
import {act,screen,fireEvent,waitFor} from '@testing-library/react';
import {expect,test} from 'vitest';
import {stockFixture,mountApp,customer,id,wire} from './stock-ui-harness';
import App from '../../src/App';
const month='2026-09-01',sourceRPC='pilot_co_report_source_proposal_v1';
const route=`/athel/co/stock?customer=${customer}&proposalDraft=${id(30)}&proposalMonth=${month}&proposalDraftVersion=1&proposalCustomerVersion=1`;
function fixture(){
 const s=stockFixture();s.draft=s.makeDraft([{batch_id:id(2001),quantity:5}]);
 const proposal={version:'1',customer_id:customer,report_month:month,draft_id:id(30),draft_version:'1',customer_version:'1',source_context:{operation:'post_return',payload:{expected_customer_version:'1',reason:'Original return source',draft_id:id(20),expected_draft_version:'1'},source_context_fingerprint:'c'.repeat(64)},owner:{kind:'return',co_id:null,report_month:null}};
 const control:{fail:null|((n:string,a:any)=>any)}={fail:null};wire.handler=async(n:string,a:any)=>{const f=await control.fail?.(n,a);if(f)return f;return n===sourceRPC?{data:proposal,error:null}:s.handle(n,a)};
 return {s,control};
}
test.each(['08006','42501'])('source-return current stock pending then %s cannot expose fresh review',async code=>{
 const {s,control}=fixture();let release!:()=>void;const pending=new Promise<void>(r=>release=r);
 control.fail=async n=>{if(n==='pilot_co_customer_stock_v1'){await pending;return {data:null,error:{code,message:'Return source unavailable'}}}return null};
 mountApp(<App/>,route);await screen.findByText('Memuat sumber retur…');expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();
 await act(async()=>release());await screen.findAllByText('Return source unavailable');expect(screen.queryByText('Memuat sumber retur…')).toBeNull();expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();expect(s.commands).toHaveLength(0);
});
test('source-return changed initial customer version refuses old draft review',async()=>{
 const {s}=fixture();s.cv='2';mountApp(<App/>,route);await screen.findByText('Usulan sumber asli tidak tersedia: pelanggan berubah.');expect(screen.queryByLabelText('Alasan perubahan')).toBeNull();expect(s.commands).toHaveLength(0);
});
test('retained source-return reason remains mounted and frozen through current-stock transport failure',async()=>{
 const {s,control}=fixture();const {client}=mountApp(<App/>,route);const reason=await screen.findByLabelText('Alasan perubahan');await waitFor(()=>expect(screen.getByRole('button',{name:'Tinjau semua dampak'}).matches(':disabled')).toBe(false));expect((reason as HTMLTextAreaElement).value).toBe('Original return source');
 control.fail=n=>n==='pilot_co_customer_stock_v1'?{data:null,error:{code:'08006',message:'Return refresh offline'}}:null;
 await act(async()=>{await client.invalidateQueries({predicate:q=>q.queryKey[4]==='source-return-current'});});await screen.findAllByText('Return refresh offline');
 expect(screen.getByDisplayValue('Original return source')).toBe(reason);expect(reason.matches(':disabled')).toBe(true);expect(screen.getByRole('button',{name:'Tinjau semua dampak'}).matches(':disabled')).toBe(true);expect(s.commands).toHaveLength(0);
});
