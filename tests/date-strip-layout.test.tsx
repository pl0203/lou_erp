import React from 'react'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Button } from '../src/components/ui/Button'
import { Field } from '../src/components/ui/Field'

// Render the actual date-strip JSX from each page without loading auth/network
// dependencies. DOM checks verify structure/behavior, not browser geometry.
const names = ['ManagerSchedule', 'DailySchedule', 'MyVisits'] as const
function strip(name: typeof names[number], selectedDate = '2026-10-18', count = 12345, isLoading = false, isError = false) {
  const source = readFileSync(`${process.env.DATE_STRIP_SOURCE_ROOT ?? '.'}/src/pages/girard/${name}.tsx`, 'utf8')
  const start = source.indexOf('<div className="bg-white border-b border-gray-100 px-4 md:px-8">')
  const end = source.indexOf('<div className="px-4 md:px-8 py-6', start)
  const jsx = source.slice(start, end).trim()
  const dates = Array.from({ length: name === 'ManagerSchedule' ? 31 : 4 }, (_, i) => new Date(Date.UTC(2026, 9, 18 + i)).toISOString().slice(0,10))
  const setSelectedDate = vi.fn()
  const schedules = Array.from({ length: count }, () => ({ scheduled_date: dates[0] }))
  const bindings = { React, Button, Field, dates, weekDates: dates.slice(0,7), selectedDate, setSelectedDate, scopedSchedules: schedules, allSchedules: schedules, isLoading, isError, parseCalendarDate: (date: string) => new Date(date + 'T12:00:00Z'), DAY_LABELS: ['Hari Ini','Besok','Dalam 2 Hari','Dalam 3 Hari'] }
  const output = ts.transpileModule(`return (${jsx})`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText
  const element = new Function(...Object.keys(bindings), output)(...Object.values(bindings))
  return { ...render(element), setSelectedDate, dates }
}
afterEach(cleanup)
for (const name of names) {
  test(`${name}: count stays complete in nonshrinking content-width tiles`, () => {
    strip(name)
    const selected = screen.getByRole('button', { pressed: true })
    expect(selected.textContent).toContain('12345 kunjungan')
    for (const button of screen.getAllByRole('button')) {
      for (const cls of ['flex-none', 'w-max', 'max-w-none', 'whitespace-nowrap']) expect(button.classList.contains(cls)).toBe(true)
    }
    expect(selected.parentElement!.classList.contains('items-start')).toBe(true)
    expect(selected.parentElement!.classList.contains('overflow-x-auto')).toBe(true)
  })
  test(`${name}: date selection and pressed state remain intact`, () => {
    const result = strip(name)
    fireEvent.click(screen.getAllByRole('button')[1])
    expect(result.setSelectedDate).toHaveBeenCalledWith(result.dates[1])
    cleanup()
    strip(name, result.dates[1])
    expect(screen.getByRole('button', { pressed: true }).textContent).toContain('Besok')
  })
  test(`${name}: loading labels are not replaced with zero counts`, () => {
    strip(name, '2026-10-18', 0, true)
    expect(screen.getAllByText('Memuat…').length).toBeGreaterThan(0)
    expect(screen.queryByText('0 kunjungan')).toBeNull()
  })
}
test('ManagerSchedule: more-dates control is outside the scroller and still selects later dates', () => {
  const result = strip('ManagerSchedule')
  const control = screen.getByLabelText('Tanggal lainnya')
  const scroller = screen.getByRole('button', { pressed: true }).parentElement!
  expect(scroller.contains(control)).toBe(false)
  expect(control.parentElement!.parentElement).toBe(scroller.parentElement)
  expect(control.parentElement!.classList.contains('w-full')).toBe(true)
  expect(control.parentElement!.classList.contains('sm:w-56')).toBe(true)
  fireEvent.change(control, { target: { value: result.dates[8] } })
  expect(result.setSelectedDate).toHaveBeenCalledWith(result.dates[8])
})
test('DailySchedule: unavailable counts stay unavailable', () => {
  strip('DailySchedule', '2026-10-18', 0, false, true)
  expect(screen.getAllByText('Belum tersedia')).toHaveLength(4)
  expect(screen.queryByText('0 kunjungan')).toBeNull()
})
