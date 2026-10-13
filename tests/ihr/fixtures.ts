import type { UUID } from '../../src/lib/leave/contracts'

// Fictional identifiers/declarations only. These do not configure real people or access.
export const employeeA: UUID = '71000000-0000-0000-0000-000000000001'
export const employeeB: UUID = '71000000-0000-0000-0000-000000000002'
export const managerA: UUID = '71000000-0000-0000-0000-000000000003'
export const directorA: UUID = '71000000-0000-0000-0000-000000000004'
export const hrA: UUID = '71000000-0000-0000-0000-000000000005'
export const hrB: UUID = '71000000-0000-0000-0000-000000000006'
export const inactiveA: UUID = '71000000-0000-0000-0000-000000000007'
export const unrelatedA: UUID = '71000000-0000-0000-0000-000000000008'
export const hrConfigureA: UUID = '71000000-0000-0000-0000-000000000009'
export const hrAdjustA: UUID = '71000000-0000-0000-0000-000000000010'
export const hrPrivateA: UUID = '71000000-0000-0000-0000-000000000011'
export const hrCalendarA: UUID = '71000000-0000-0000-0000-000000000012'
export const hrAccessA: UUID = '71000000-0000-0000-0000-000000000013'

export const syntheticHrVariants = [
  { id: hrConfigureA, capabilities: ['configure'], employeeIds: [employeeA] },
  { id: hrAdjustA, capabilities: ['adjust'], employeeIds: [employeeA] },
  { id: hrPrivateA, capabilities: ['read_private'], employeeIds: [employeeA] },
  { id: hrCalendarA, capabilities: ['calendar'], employeeIds: [employeeA] },
  { id: hrAccessA, capabilities: ['manage_access'], employeeIds: [employeeA] },
  { id: hrA, capabilities: ['configure', 'adjust', 'read_private', 'calendar'], employeeIds: [employeeA] },
  { id: hrB, capabilities: ['configure', 'adjust', 'read_private', 'calendar', 'manage_access'], employeeIds: [employeeB] },
] as const
