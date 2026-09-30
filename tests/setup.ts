import { beforeEach, vi } from 'vitest'
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network disabled in safety tests') })) })
