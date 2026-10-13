import { webcrypto } from 'node:crypto'
import { beforeEach, vi } from 'vitest'
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network disabled in safety tests') })) })
