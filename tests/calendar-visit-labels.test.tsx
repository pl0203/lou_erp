import React from 'react'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
vi.mock('../src/lib/supabase',()=>({supabase:{}}))
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>({profile:{id:'dummy',role:'executive'}})}))
vi.mock('../src/components/GirardNav',()=>({default:()=>null}))
vi.mock('react-router-dom',()=>({useNavigate:()=>()=>{}}))
vi.mock('@tanstack/react-query',()=>({useQuery:()=>({data:[],isLoading:false})}))
import MyVisits from '../src/pages/girard/MyVisits'
import DailySchedule from '../src/pages/girard/DailySchedule'
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))})
afterEach(()=>{cleanup();vi.useRealTimers()})
for(const [name,Page] of [['own visits',MyVisits],['daily schedule',DailySchedule]] as const)test(`${name} displays September30 as September30`,()=>{
 render(<Page/>);expect(screen.getByText(/30 September/)).toBeTruthy()
})

vi.mock('../src/components/VisitRequestInbox', () => ({ default: () => null, VisitProposalForm: () => null }))
vi.mock('../src/lib/useUnsavedChanges', () => ({ useUnsavedChanges: () => ({ dialog: null, confirmDiscard: (fn: any) => fn() }) }))
