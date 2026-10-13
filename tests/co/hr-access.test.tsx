import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, test, vi } from 'vitest'
const state=vi.hoisted(()=>({context:{scopeVersion:'1',memberKind:null,capabilities:{request:false,approve:false,configure:false,adjust:false,readPrivate:false,manageAccess:false},setup:{ready:false,blockers:[{code:'member_missing',message:'Keanggotaan kebijakan cuti belum ditetapkan.'}]},balances:[],timezone:null}}))
vi.mock('../../src/lib/AuthContext',()=>({useAuth:()=>({user:{id:'actor'},profile:{id:'actor',is_active:true,role:'co_admin'},loading:false})}))
vi.mock('../../src/lib/leave/useLeaveContext',()=>({useLeaveContext:()=>({data:state.context,authorityReady:true,isFetching:false,isPending:false,authorityPending:false})}))
vi.mock('../../src/components/IHRNav',()=>({default:()=>null}))
vi.mock('../../src/pages/ihr/leave/LeaveTabs',()=>({default:()=>null}))
import LeaveManagement from '../../src/pages/ihr/LeaveManagement'
afterEach(cleanup)
test('unconfigured CO sees truthful setup guidance and no fabricated balance',()=>{render(<QueryClientProvider client={new QueryClient()}><LeaveManagement /></QueryClientProvider>);expect(screen.getByText('Pengaturan cuti belum lengkap')).toBeTruthy();expect(screen.getByText('Keanggotaan kebijakan cuti belum ditetapkan.')).toBeTruthy();expect(screen.queryByRole('tab')).toBeNull()})
