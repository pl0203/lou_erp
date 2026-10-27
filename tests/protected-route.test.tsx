import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
const auth = vi.hoisted(() => ({ user: {id:'a'}, profile:null as any, loading:false }))
vi.mock('../src/lib/AuthContext', () => ({useAuth: () => auth}))
import ProtectedRoute from '../src/components/ProtectedRoute'
afterEach(cleanup)
for (const [name, profile] of [['missing',null],['inactive',{id:'a',role:'executive',is_active:false}],['wrong identity',{id:'b',role:'executive',is_active:true}]]) {
 test(`denies ${name} profile`, () => {
  auth.profile=profile
  render(<MemoryRouter initialEntries={['/secret']}><Routes><Route path='/login' element={<p>login</p>}/><Route path='/secret' element={<ProtectedRoute allowedRoles={['executive']}><p>secret</p></ProtectedRoute>}/></Routes></MemoryRouter>)
  expect(screen.queryByText('secret')).toBeNull()
  expect(screen.getByText('login')).toBeTruthy()
 })
}
