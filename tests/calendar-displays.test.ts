// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
vi.mock('../src/lib/supabase',()=>({supabase:{}}))
import { displayDay, rollingMonthKeys, rangeDays } from '../src/pages/athel/Dashboard'
import { isEditable, getNext30Days } from '../src/pages/girard/ManagerSchedule'
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))})
afterEach(()=>vi.useRealTimers())
test('same frozen instant includes current September in twelve rolling month buckets',()=>{
 const keys=rollingMonthKeys(12)
 expect(keys).toHaveLength(12);expect(keys[0]).toBe('2025-10');expect(keys.at(-1)).toBe('2026-09')
})
test('date-only daily chart labels preserve the stored calendar day',()=>{
 expect(displayDay('2026-09-30')).toContain('30')
 expect(displayDay('2026-07-01')).toContain('1')
 expect(displayDay('2026-07-01')).not.toContain('30')
 expect(rangeDays('2026-09-30','2026-10-02')).toEqual(['2026-09-30','2026-10-01','2026-10-02'])
})
test('schedule today keys follow local calendar even close to UTC day boundary',()=>{
 vi.setSystemTime(new Date('2026-09-30T01:00:00Z'))
 const d=new Date();const expected=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
 expect(getNext30Days()[0]).toBe(expected)
})
test('schedule edit cutoff locks today and tomorrow but permits day after tomorrow',()=>{
 expect(isEditable('2026-09-30')).toBe(false);expect(isEditable('2026-10-01')).toBe(false);expect(isEditable('2026-10-02')).toBe(true)
})
test('schedule edit cutoff is calendar-based across daylight-saving boundary',()=>{
 vi.setSystemTime(new Date('2026-11-01T12:00:00Z'))
 expect(isEditable('2026-11-01')).toBe(false);expect(isEditable('2026-11-02')).toBe(false);expect(isEditable('2026-11-03')).toBe(true)
})
