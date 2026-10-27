import { beginIntegrated, readyPreview, deferred, syntheticFile, extractor, integratedServer, checkMapping } from './import-acceptance-harness';
import { test, expect } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { wire, mount, id } from '../report-ui-harness';
import COMonthlyReport from '../../../src/pages/athel/co/COMonthlyReport';
const phases=['context','eligible','prepare','preview','commit'] as const;
const changes=['inactive','denied-role','expired-server-authority'] as const;
// Expiry is an authoritative42501 fixture, not proof of PostgreSQL end-date policy execution.
test.each(phases.flatMap(phase=>changes.map(change=>({phase,change}))))('$change at pending $phase clears private owner/cache and cannot restore a late result',async({phase,change})=>{
 const {f,client,router}=await beginIntegrated();if(phase==='commit')await readyPreview();const gate=deferred();let started=false;
 const target={context:'pilot_co_report_v1',eligible:'pilot_co_import_eligible_v1',prepare:'pilot_co_import_prepare_v1',preview:'pilot_co_import_preview_v1',commit:'pilot_co_import_commit_v1'}[phase];
 const beforeCount=wire.rpc.mock.calls.filter(([n])=>n===target).length;
 wire.handler=async(n,a)=>{if(n===target){started=true;await gate.promise;if(change==='expired-server-authority')return {data:null,error:{code:'42501',message:'Expired employee authority'}}}return f.server(n,a)};
 fireEvent.click(screen.getByRole('button',{name:phase==='commit'?'Catat penjualan':'Tinjau pencatatan'}));await waitFor(()=>expect(started).toBe(true));
 const entries=Object.keys(localStorage).map(key=>({key,value:localStorage.getItem(key)!}));
 if(change!=='expired-server-authority'){if(change==='inactive')wire.active=false;else wire.role='sales';await act(()=>router.revalidate());await waitFor(()=>expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull())}
 await act(async()=>gate.resolve());if(change==='expired-server-authority')await screen.findByText('Expired employee authority');
 expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(client.getQueryCache().getAll().filter(q=>q.queryKey[0]==='co'&&q.state.data)).toHaveLength(0);
 expect(wire.rpc.mock.calls.filter(([n])=>n===target)).toHaveLength(beforeCount+1);
 const writes=f.requests.filter(r=>r.n==='pilot_co_import_commit_v1').length;await act(async()=>{await Promise.resolve()});expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(writes);
 if(change!=='expired-server-authority')for(const entry of entries)expect(JSON.parse(localStorage.getItem(entry.key)!).id).toBe(JSON.parse(entry.value).id);
});
test('wrong server customer during canonical preparation is refused before evidence or monthly transaction',async()=>{
 const {f}=await beginIntegrated();wire.handler=async(n,a)=>{const r=await f.server(n,a);if(n==='pilot_co_report_v1')r.data.customer_id=id(99);return r};fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await screen.findByRole('alert');expect(f.requests.filter(r=>r.n==='pilot_co_import_prepare_v1')).toHaveLength(0);expect(wire.invoke).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
});
test('wrong source month stays explicit unresolved and cannot reach evidence/prepare/commit',async()=>{
 const f=integratedServer(),source=await syntheticFile('pdf');source.extracted.periodCandidates=['2026-08-01'];extractor.extract.mockReset().mockResolvedValue(source.extracted);mount(<COMonthlyReport/>);fireEvent.change(await screen.findByLabelText('Pilih PDF atau XLSX'),{target:{files:[source.file]}});await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');await checkMapping();fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));expect(f.requests.filter(r=>r.n==='pilot_co_import_prepare_v1')).toHaveLength(0);expect(wire.invoke).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();expect(screen.getByRole('region',{name:'Hal yang perlu diperiksa'}).textContent).toContain('period_mismatch');
});

test('executive can complete the same checked upload confirmation without broadening denied roles',async()=>{
 wire.role='executive';const {f}=await beginIntegrated();await readyPreview();fireEvent.click(screen.getByRole('button',{name:'Catat penjualan'}));await screen.findByRole('button',{name:'Edit'});expect(f.requests.filter(r=>r.n==='pilot_co_import_prepare_v1')).toHaveLength(1);expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(1);
});
test.each(['sales','hr_admin'])('initial denied role %s never opens private monthly source or sends a command',async role=>{
 const f=integratedServer();wire.role=role;mount(<COMonthlyReport/>);await act(async()=>{await Promise.resolve()});expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(f.requests).toHaveLength(0);expect(wire.invoke).not.toHaveBeenCalled();
});
