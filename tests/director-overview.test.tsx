// @vitest-environment jsdom
import React from 'react'
import { afterEach,expect,it,vi } from 'vitest'
import { render,screen,cleanup,fireEvent,within } from '@testing-library/react'
const mocks=vi.hoisted(()=>({read:vi.fn()}))
vi.mock('../src/lib/leave/useLeaveReads',()=>({useAuthorizedLeaveRead:mocks.read}))
vi.mock('../src/lib/leave/directorRpc',()=>({fetchDirectorRequests:vi.fn()}))
vi.mock('../src/components/ui/Button',()=>({Button:({children,variant,...props}:any)=><button {...props}>{children}</button>}))
vi.mock('../src/components/ui/Feedback',()=>({EmptyState:({title}:any)=><p>{title}</p>}))
vi.mock('../src/components/ui/RecordList',()=>({RecordList:({children,label}:any)=><ul aria-label={label}>{children}</ul>}))
import Overview from '../src/pages/ihr/leave/DirectorLeaveOverview'
const context:any={memberKind:'director',scopeVersion:'1',capabilities:{approve:false}}
const row={id:'a',sequence:9,employeeId:'b',employeeName:'Test staff',startDate:'2026-10-20',endDate:'2026-10-21',totalMinutes:900,status:'submitted',submittedAt:'2026-10-17T00:00:00Z',approverName:'Assigned manager'}
afterEach(()=>{cleanup();mocks.read.mockReset()})
it('shows read-only all-active overview even without approval assignments',()=>{
 mocks.read.mockReturnValue({available:true,isCurrent:()=>true,data:{rows:[row],nextBefore:null},displayData:{rows:[row],nextBefore:null}})
 render(<Overview actorId="director" context={context}/>);expect(screen.getByText('Test staff')).toBeTruthy();expect(screen.getByRole('columnheader',{name:'Penyetuju permohonan'})).toBeTruthy();expect(within(screen.getByRole('row',{name:/Test staff/})).getByRole('cell',{name:'Assigned manager'})).toBeTruthy()
 expect(screen.queryByRole('button',{name:/Setujui|Tolak|Tinjau/})).toBeNull()
 expect(mocks.read.mock.calls[0][5]({memberKind:'employee'})).toBe(false)
})
it('does not render for non-directors',()=>{render(<Overview actorId="manager" context={{...context,memberKind:'manager'}}/>);expect(mocks.read).not.toHaveBeenCalled()})
it('hides cached rows while shared authority is pending',()=>{mocks.read.mockReturnValue({available:true,isCurrent:()=>true,data:{rows:[row],nextBefore:null},displayData:{rows:[row],nextBefore:null}});render(<Overview actorId="director" context={context} readState="pending"/>);expect(screen.queryByText('Test staff')).toBeNull()})
it('hides rows when live authorization is unavailable and offers retry',()=>{mocks.read.mockReturnValue({available:false,isCurrent:()=>false,data:{rows:[row],nextBefore:null},displayData:undefined,refetch:vi.fn()});render(<Overview actorId="director" context={context}/>);expect(screen.queryByText('Test staff')).toBeNull();expect(screen.getByRole('button',{name:'Muat ulang ringkasan'})).toBeTruthy()})
it('paginates using returned cursor, resetting with scope identity',()=>{mocks.read.mockReturnValue({available:true,isCurrent:()=>true,data:{rows:[row],nextBefore:9},displayData:{rows:[row],nextBefore:9}});const view=render(<Overview actorId="director" context={context}/>);fireEvent.click(screen.getByRole('button',{name:'Lebih lama'}));expect(mocks.read.mock.lastCall![2]).toContain(9);view.rerender(<Overview actorId="director" context={{...context,scopeVersion:'2'}}/>);expect(mocks.read.mock.lastCall![2]).toContain(null)})
it('retained refreshing overview is read-only and cannot paginate without current authority',()=>{
 const isCurrent=vi.fn(()=>false),data={rows:[row],nextBefore:9}
 mocks.read.mockReturnValue({available:false,isCurrent,data,displayData:data})
 render(<Overview actorId="director" context={context} readState="refreshing"/>)
 expect(screen.getByText('Test staff')).toBeTruthy()
 const next=screen.getByRole('button',{name:'Lebih lama'}) as HTMLButtonElement
 expect(next.disabled).toBe(true);fireEvent.click(next)
 expect(mocks.read.mock.lastCall![2]).toContain(null)
 expect(screen.queryByRole('button',{name:/Setujui|Tolak|Tinjau/})).toBeNull()
})
it('a no-longer-current receipt locks pagination even if available was previously true',()=>{
 const isCurrent=vi.fn(()=>false),data={rows:[row],nextBefore:9}
 mocks.read.mockReturnValue({available:true,isCurrent,data,displayData:data})
 render(<Overview actorId="director" context={context}/>)
 expect((screen.getByRole('button',{name:'Lebih lama'}) as HTMLButtonElement).disabled).toBe(true)
 expect(isCurrent).toHaveBeenCalled()
})
