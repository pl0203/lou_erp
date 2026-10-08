import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
import type { LeaveContext } from '../../src/lib/leave/contracts'
import { employeeA, employeeB } from './fixtures'
const mocks=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../../src/lib/supabase',()=>({supabase:{rpc:mocks.rpc}}))
import MyLeave from '../../src/pages/ihr/leave/MyLeave'
import LeaveBalanceSettings from '../../src/pages/ihr/leave/LeaveBalanceSettings'
const balance={accountId:employeeA,year:2026,allowanceMinutes:5400,approvedMinutes:450,pendingMinutes:60,availableMinutes:4890,expiredMinutes:0,version:4,reconciled:true}
const context:LeaveContext={scopeVersion:'1',memberKind:'employee',capabilities:{request:true,approve:false,configure:false,adjust:false,readPrivate:false,manageAccess:false},currentPeriod:{year:2026,startDate:'2026-01-01',endDate:'2027-01-01'},timezone:'Etc/UTC',setup:{ready:false,blockers:[{code:'approver_missing',message:'Penyetuju belum ada'}]},balances:[balance]}
const clients:QueryClient[]=[]
function wrap(child:React.ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);return <QueryClientProvider client={client}>{child}</QueryClientProvider>}
afterEach(()=>{cleanup();clients.splice(0).forEach(c=>c.clear());mocks.rpc.mockReset()})
test('unverified opening explicitly labels unknown buckets and never shows spendable 90 hours',()=>{
 render(wrap(<MyLeave actorId={employeeA} context={{...context,balances:[{...balance,reconciled:false,approvedMinutes:null,pendingMinutes:null,availableMinutes:null,expiredMinutes:null}]}}/>))
 expect(screen.getAllByText('Belum diverifikasi')).toHaveLength(3)
 expect(screen.getByText('90j')).toBeTruthy();expect(screen.queryByText('81j 30m')).toBeNull()
 expect(mocks.rpc).not.toHaveBeenCalled()
})
test('verified numbers remain visible despite missing approver and explain future approved usage',()=>{
 render(wrap(<MyLeave actorId={employeeA} context={context}/>))
 expect(screen.getByText('81j 30m')).toBeTruthy();expect(screen.getByText('7j 30m')).toBeTruthy();expect(screen.getByText(/Termasuk cuti disetujui di masa depan/)).toBeTruthy()
})
test('available hours lead the balance summary and remain above an opened request form',async()=>{
 mocks.rpc.mockImplementation(()=>({abortSignal:()=>Promise.resolve({data:context,error:null})}))
 render(wrap(<MyLeave actorId={employeeA} context={context}/>))
 const balanceSummary=screen.getByRole('region',{name:'Saldo cuti'})
 expect(within(balanceSummary).getAllByRole('term')[0].textContent).toBe('Tersedia')
 expect(within(balanceSummary).getByText('81j 30m').className).toContain('text-4xl')
 expect(screen.getByRole('button',{name:'Ajukan cuti'}).classList.contains('bg-brand-primary')).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Ajukan cuti'}))
 const form=await screen.findByRole('region',{name:'Formulir pratinjau cuti'})
 expect(balanceSummary.compareDocumentPosition(form)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
 expect(document.activeElement).toBe(await screen.findByLabelText('Tanggal mulai'))
})
test('old omitted server period blocks prepare, while current eligible missing account offers explicit preparation',()=>{
 const {currentPeriod:_,...old}=context;const view=render(wrap(<MyLeave actorId={employeeA} context={{...old,balances:[]}}/>))
 expect(screen.queryByRole('button',{name:'Siapkan jatah tahun ini'})).toBeNull();expect(screen.getByText(/Periode tahunan belum dikonfirmasi/)).toBeTruthy()
 view.rerender(wrap(<MyLeave actorId={employeeA} context={{...context,balances:[]}}/>))
 expect(screen.getByRole('button',{name:'Siapkan jatah tahun ini'})).toBeTruthy();expect(mocks.rpc).not.toHaveBeenCalled()
})
test('history displays signed entries and revocation closes all personal content',async()=>{
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?context:{balance,rows:[{id:employeeB,sequence:3,date:'2026-10-02',kind:'adjustment',allowanceDelta:-60,reservedDelta:0,usedDelta:0}],nextBefore:null},error:null})}))
 const wrapper=wrap(<MyLeave actorId={employeeA} context={context}/>),view=render(wrapper)
 fireEvent.click(screen.getByRole('button',{name:'Riwayat saldo'}));expect(await screen.findByText('−1j')).toBeTruthy()
 view.rerender(<QueryClientProvider client={clients[0]}><MyLeave actorId={employeeA} context={{...context,scopeVersion:'2',memberKind:'director',currentPeriod:null,balances:[],capabilities:{...context.capabilities,request:false}}}/></QueryClientProvider>)
 expect(screen.queryByText('−1j')).toBeNull();expect(screen.queryByText('90j')).toBeNull();expect(screen.queryByRole('button',{name:'Riwayat saldo'})).toBeNull()
})
test('expired allowance is visibly nonspendable',()=>{
 render(wrap(<MyLeave actorId={employeeA} context={{...context,balances:[{...balance,year:2025,availableMinutes:0,expiredMinutes:4890}]}}/>))
 expect(screen.getByText(/Kedaluwarsa, tidak dapat dipakai/)).toBeTruthy();expect(screen.getByText('81j 30m')).toBeTruthy();expect(screen.getByText('0j')).toBeTruthy()
})
test('balance settings require independent actor and current server period',()=>{
 render(<LeaveBalanceSettings actorId={employeeA} employeeId={employeeA} currentPeriod={context.currentPeriod!} balance={balance} canConfigure canAdjust send={vi.fn()}/>)
 expect(screen.getByText(/Administrator lain/)).toBeTruthy()
 expect((screen.getByRole('button',{name:'Simpan penyesuaian'}) as HTMLButtonElement).disabled).toBe(true)
})
test('adjustment preserves input on failure, prevents repeat clicks, and uses exact signed integer minutes',async()=>{
 let reject!:(e:Error)=>void;const send=vi.fn(()=>new Promise<never>((_,r)=>reject=r))
 render(<LeaveBalanceSettings actorId={employeeB} employeeId={employeeA} currentPeriod={context.currentPeriod!} balance={balance} canConfigure={false} canAdjust send={send}/>)
 fireEvent.change(screen.getByLabelText('Menit penyesuaian'),{target:{value:'-60'}});fireEvent.change(screen.getByLabelText('ID sumber'),{target:{value:employeeB}});fireEvent.change(screen.getByLabelText('Alasan'),{target:{value:'Reviewed correction'}})
 const button=screen.getByRole('button',{name:'Simpan penyesuaian'});fireEvent.click(button);fireEvent.click(button)
 expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0]).toMatchObject({operation:'adjust_balance',deltaMinutes:-60,year:2026,expectedVersion:4,sourceId:employeeB})
 await act(async()=>reject(new Error('raw private data')))
 expect(await screen.findByRole('alert')).toBeTruthy();expect((screen.getByLabelText('Menit penyesuaian') as HTMLInputElement).value).toBe('-60');expect(screen.queryByText('raw private data')).toBeNull()
})
test('opening captures allowance, past usage and explicit future sources; authority revocation disables submission',async()=>{
 const send=vi.fn().mockResolvedValue({id:employeeA,version:4,operation:'reconcile_opening'})
 const props={actorId:employeeB,employeeId:employeeA,currentPeriod:context.currentPeriod!,balance:{...balance,reconciled:false},canConfigure:true,canAdjust:false,send}
 const view=render(<LeaveBalanceSettings {...props}/>)
 for(const [label,value] of [['Jatah tahunan diverifikasi (menit)','5400'],['Pemakaian sampai tanggal pembukaan (menit)','450'],['Tanggal pembukaan','2026-10-02'],['ID sumber',employeeB],['Alasan','Verified opening']])fireEvent.change(screen.getByLabelText(label),{target:{value}})
 fireEvent.click(screen.getByLabelText('Daftar cuti disetujui di masa depan sudah lengkap'))
 fireEvent.click(screen.getByRole('button',{name:'Simpan saldo awal'}))
 await waitFor(()=>expect(send).toHaveBeenCalledTimes(1));expect(send.mock.calls[0][0]).toMatchObject({allowanceMinutes:5400,pastUsedMinutes:450,futureApproved:[],asOf:'2026-10-02'})
 view.rerender(<LeaveBalanceSettings {...props} canConfigure={false}/>)
 expect(screen.queryByRole('button',{name:'Simpan saldo awal'})).toBeNull()
})
test('settings refuse a stale different-year account instead of borrowing its version for the current year',()=>{
 render(<LeaveBalanceSettings actorId={employeeB} employeeId={employeeA} currentPeriod={context.currentPeriod!} balance={{...balance,year:2025}} canConfigure canAdjust send={vi.fn()}/>)
 expect(screen.getByText(/Periode saldo tidak cocok/)).toBeTruthy()
 expect(screen.queryByRole('button',{name:'Simpan penyesuaian'})).toBeNull()
})
test('history refreshes authority before its private read and refuses changed scope',async()=>{
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>Promise.resolve({data:name==='leave_context_v1'?{...context,scopeVersion:'2'}:{balance,rows:[],nextBefore:null},error:null})}))
 render(wrap(<MyLeave actorId={employeeA} context={context}/>));fireEvent.click(screen.getByRole('button',{name:'Riwayat saldo'}))
 await waitFor(()=>expect(mocks.rpc).toHaveBeenCalled())
 expect(mocks.rpc.mock.calls[0][0]).toBe('leave_context_v1')
 expect(mocks.rpc.mock.calls.some(([name])=>name==='leave_balance_history_v1')).toBe(false)
})
test.each(['denied','director'])('cached history stays hidden while reopening authority is pending and after %s',async outcome=>{
 let hold=false,finish!:(value:unknown)=>void
 const entry={id:employeeB,sequence:3,date:'2026-10-02',kind:'adjustment',allowanceDelta:-60,reservedDelta:0,usedDelta:0}
 mocks.rpc.mockImplementation((name:string)=>({abortSignal:()=>name==='leave_context_v1'&&hold?new Promise(r=>finish=r):Promise.resolve({data:name==='leave_context_v1'?context:{balance,rows:[entry],nextBefore:null},error:null})}))
 render(wrap(<MyLeave actorId={employeeA} context={context}/>))
 fireEvent.click(screen.getByRole('button',{name:'Riwayat saldo'}));expect(await screen.findByText('−1j')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Tutup riwayat saldo'}));hold=true;fireEvent.click(screen.getByRole('button',{name:'Riwayat saldo'}))
 await waitFor(()=>expect(finish).toBeDefined());expect(screen.queryByText('−1j')).toBeNull()
 await act(async()=>finish(outcome==='denied'?{data:null,error:{code:'42501'}}:{data:{...context,scopeVersion:'2',memberKind:'director',currentPeriod:null,balances:[],capabilities:{...context.capabilities,request:false}},error:null}))
 expect(screen.queryByText('−1j')).toBeNull();expect(await screen.findByRole('alert')).toBeTruthy()
 expect(mocks.rpc.mock.calls.filter(([name])=>name==='leave_balance_history_v1')).toHaveLength(1)
})
test('each history page including a cached return waits for its own authority refresh',async()=>{
 let hold=false,finish!:(value:unknown)=>void
 mocks.rpc.mockImplementation((name:string,args?:{p_before:number|null})=>({abortSignal:()=>name==='leave_context_v1'&&hold?new Promise(r=>finish=r):Promise.resolve({data:name==='leave_context_v1'?context:{balance,rows:[{id:employeeB,sequence:args?.p_before?2:3,date:'2026-10-02',kind:'adjustment',allowanceDelta:args?.p_before?-120:-60,reservedDelta:0,usedDelta:0}],nextBefore:args?.p_before?null:3},error:null})}))
 render(wrap(<MyLeave actorId={employeeA} context={context}/>));fireEvent.click(screen.getByRole('button',{name:'Riwayat saldo'}));expect(await screen.findByText('−1j')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Lebih lama'}));expect(await screen.findByText('−2j')).toBeTruthy()
 hold=true;fireEvent.click(screen.getByRole('button',{name:'Lebih baru'}));await waitFor(()=>expect(finish).toBeDefined())
 expect(screen.queryByText('−1j')).toBeNull();expect(screen.queryByText('−2j')).toBeNull()
 await act(async()=>finish({data:context,error:null}));expect(await screen.findByText('−1j')).toBeTruthy()
})
test('an obsolete opening authority response cannot publish history after account change',async()=>{
 let finish!:(value:unknown)=>void
 mocks.rpc.mockReturnValue({abortSignal:()=>new Promise(r=>finish=r)})
 const q=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(q)
 const view=render(<QueryClientProvider client={q}><MyLeave actorId={employeeA} context={context}/></QueryClientProvider>)
 fireEvent.click(screen.getByRole('button',{name:'Riwayat saldo'}));await waitFor(()=>expect(finish).toBeDefined())
 view.rerender(<QueryClientProvider client={q}><MyLeave actorId={employeeB} context={{...context,scopeVersion:'2',balances:[]}}/></QueryClientProvider>)
 await act(async()=>finish({data:context,error:null}))
 expect(screen.queryByText('−1j')).toBeNull();expect(mocks.rpc.mock.calls.some(([name])=>name==='leave_balance_history_v1')).toBe(false)
})
test('clean editor adopts fresh same-year version before a new adjustment draft',async()=>{
 const send=vi.fn().mockResolvedValue({id:employeeA,version:6,operation:'adjust_balance'}),props={actorId:employeeB,employeeId:employeeA,currentPeriod:context.currentPeriod!,balance,canConfigure:false,canAdjust:true,send}
 const view=render(<LeaveBalanceSettings {...props}/>);view.rerender(<LeaveBalanceSettings {...props} balance={{...balance,version:5}}/>)
 for(const [label,value] of [['Menit penyesuaian','-60'],['ID sumber',employeeB],['Alasan','Reviewed correction']])fireEvent.change(screen.getByLabelText(label),{target:{value}})
 fireEvent.click(screen.getByRole('button',{name:'Simpan penyesuaian'}));await waitFor(()=>expect(send).toHaveBeenCalledTimes(1));expect(send.mock.calls[0][0].expectedVersion).toBe(5)
})
test('clean missing-account editor adopts a newly verified current account',()=>{
 const props={actorId:employeeB,employeeId:employeeA,currentPeriod:context.currentPeriod!,canConfigure:true,canAdjust:true,send:vi.fn()}
 const view=render(<LeaveBalanceSettings {...props}/>);view.rerender(<LeaveBalanceSettings {...props} balance={balance}/>)
 expect(screen.queryByRole('button',{name:'Simpan saldo awal'})).toBeNull();expect(screen.queryByText('Rekonsiliasi saldo awal diperlukan sebelum penyesuaian.')).toBeNull()
})
test('dirty same-target adjustment preserves input and requires explicit review before rebasing',async()=>{
 const send=vi.fn().mockResolvedValue({id:employeeA,version:6,operation:'adjust_balance'}),props={actorId:employeeB,employeeId:employeeA,currentPeriod:context.currentPeriod!,balance,canConfigure:false,canAdjust:true,send}
 const view=render(<LeaveBalanceSettings {...props}/>)
 for(const [label,value] of [['Menit penyesuaian','-60'],['ID sumber',employeeB],['Alasan','Reviewed correction']])fireEvent.change(screen.getByLabelText(label),{target:{value}})
 view.rerender(<LeaveBalanceSettings {...props} balance={{...balance,version:5}}/>)
 expect((screen.getByLabelText('Menit penyesuaian') as HTMLInputElement).value).toBe('-60')
 expect(screen.getByText(/Saldo berubah sejak draf ini dimulai/)).toBeTruthy();expect((screen.getByRole('button',{name:'Simpan penyesuaian'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Gunakan saldo terbaru untuk draf ini'}));expect(send).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Simpan penyesuaian'}));await waitFor(()=>expect(send).toHaveBeenCalledTimes(1));expect(send.mock.calls[0][0]).toMatchObject({expectedVersion:5,deltaMinutes:-60,reason:'Reviewed correction'})
})
test('stale-conflict recovery can discard dirty input and adopt current verified server state',async()=>{
 const send=vi.fn().mockRejectedValue(new Error('stale')),props={actorId:employeeB,employeeId:employeeA,currentPeriod:context.currentPeriod!,balance,canConfigure:true,canAdjust:true,send}
 const view=render(<LeaveBalanceSettings {...props}/>)
 for(const [label,value] of [['Menit penyesuaian','-60'],['ID sumber',employeeB],['Alasan','Reviewed correction']])fireEvent.change(screen.getByLabelText(label),{target:{value}})
 fireEvent.click(screen.getByRole('button',{name:'Simpan penyesuaian'}));await screen.findByRole('alert')
 view.rerender(<LeaveBalanceSettings {...props} balance={{...balance,version:5}}/>)
 fireEvent.click(screen.getByRole('button',{name:'Buang draf dan gunakan saldo terbaru'}))
 expect((screen.getByLabelText('Menit penyesuaian') as HTMLInputElement).value).toBe('');expect((screen.getByLabelText('Alasan') as HTMLInputElement).value).toBe('');expect(screen.queryByRole('alert')).toBeNull()
 send.mockResolvedValue({id:employeeA,version:6,operation:'adjust_balance'})
 for(const [label,value] of [['Menit penyesuaian','60'],['ID sumber',employeeB],['Alasan','New reviewed correction']])fireEvent.change(screen.getByLabelText(label),{target:{value}})
 fireEvent.click(screen.getByRole('button',{name:'Simpan penyesuaian'}));await waitFor(()=>expect(send).toHaveBeenCalledTimes(2));expect(send.mock.calls[1][0].expectedVersion).toBe(5)
})
test('dirty opening cannot overwrite newly verified account and revocation discards the draft',()=>{
 const props={actorId:employeeB,employeeId:employeeA,currentPeriod:context.currentPeriod!,canConfigure:true,canAdjust:true,send:vi.fn()}
 const view=render(<LeaveBalanceSettings {...props}/>);fireEvent.change(screen.getByLabelText('Alasan'),{target:{value:'Private opening draft'}})
 view.rerender(<LeaveBalanceSettings {...props} balance={balance}/>);expect(screen.getByText(/Saldo berubah sejak draf ini dimulai/)).toBeTruthy()
 expect((screen.getByRole('button',{name:'Simpan saldo awal'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:'Gunakan saldo terbaru untuk draf ini'}));expect(screen.queryByRole('button',{name:'Simpan saldo awal'})).toBeNull()
 view.rerender(<LeaveBalanceSettings {...props} balance={balance} canConfigure={false} canAdjust={false}/>);expect(screen.queryByDisplayValue('Private opening draft')).toBeNull()
 view.rerender(<LeaveBalanceSettings {...props} balance={balance}/>);expect((screen.getByLabelText('Alasan') as HTMLInputElement).value).toBe('')
})
test('receipt-matching readback preserves a new dirty draft without falsely requiring another rebase',async()=>{
 const send=vi.fn().mockResolvedValue({id:employeeA,version:5,operation:'adjust_balance'}),props={actorId:employeeB,employeeId:employeeA,currentPeriod:context.currentPeriod!,balance,canConfigure:false,canAdjust:true,send}
 const view=render(<LeaveBalanceSettings {...props}/>)
 for(const [label,value] of [['Menit penyesuaian','-60'],['ID sumber',employeeB],['Alasan','First reviewed correction']])fireEvent.change(screen.getByLabelText(label),{target:{value}})
 fireEvent.click(screen.getByRole('button',{name:'Simpan penyesuaian'}));await screen.findByText(/Saldo tersimpan/)
 fireEvent.change(screen.getByLabelText('Alasan'),{target:{value:'Next reviewed correction'}})
 view.rerender(<LeaveBalanceSettings {...props} balance={{...balance,version:5}}/>)
 expect(screen.queryByText(/Saldo berubah sejak draf ini dimulai/)).toBeNull();expect((screen.getByLabelText('Alasan') as HTMLInputElement).value).toBe('Next reviewed correction')
})
test('incomplete opening-only rows cannot poison a valid adjustment after keep-draft verified rebase',async()=>{
 const send=vi.fn().mockResolvedValue({id:employeeA,version:5,operation:'adjust_balance'})
 const props={actorId:employeeB,employeeId:employeeA,currentPeriod:context.currentPeriod!,canConfigure:true,canAdjust:true,send}
 const view=render(<LeaveBalanceSettings {...props}/>)
 fireEvent.click(screen.getByRole('button',{name:'Tambah cuti disetujui'}))
 fireEvent.change(screen.getByLabelText('Alasan'),{target:{value:'Started opening review'}})
 view.rerender(<LeaveBalanceSettings {...props} balance={balance}/>)
 fireEvent.click(screen.getByRole('button',{name:'Gunakan saldo terbaru untuk draf ini'}))
 expect(screen.queryByRole('button',{name:'Simpan saldo awal'})).toBeNull()
 expect(screen.queryByLabelText('Total menit diverifikasi 1')).toBeNull()
 expect(screen.queryByRole('button',{name:'Buang draf dan gunakan saldo terbaru'})).toBeNull()
 for(const [label,value] of [['Menit penyesuaian','-60'],['ID sumber',employeeB],['Alasan','Reviewed correction']])fireEvent.change(screen.getByLabelText(label),{target:{value}})
 fireEvent.click(screen.getByRole('button',{name:'Simpan penyesuaian'}))
 await waitFor(()=>expect(send).toHaveBeenCalledTimes(1))
 expect(send.mock.calls[0][0]).toEqual({operation:'adjust_balance',employeeId:employeeA,year:2026,expectedVersion:4,deltaMinutes:-60,sourceId:employeeB,reason:'Reviewed correction'})
 expect(screen.queryByRole('alert')).toBeNull()
})
