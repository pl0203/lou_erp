import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { compressVisitPhoto } from '../src/lib/visitPhoto'

const TARGET = 500 * 1024
const LIMIT = 3 * 1024 * 1024
let dimensions = { width: 2400, height: 1800 }
const drawImage = vi.fn()
const bytes = (size: number, type = 'image/webp') => new Blob([new Uint8Array(size)], { type })

beforeEach(() => {
  dimensions = { width: 2400, height: 1800 }
  drawImage.mockClear()
  vi.stubGlobal('Image', class {
    width = dimensions.width; height = dimensions.height
    onload?: () => void
    set src(_: string) { queueMicrotask(() => this.onload?.()) }
  })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:input'), revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as any)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(bytes(100 * 1024)))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

// Browser canvas encoding is the boundary stub; the production compressor decides
// format, dimensions, attempt bounds, and whether the actual output is acceptable.
test('already-small output stops after the first encode without chasing a smaller file', async () => {
  const output = await compressVisitPhoto(bytes(1000, 'image/png'))
  expect(output.size).toBe(100 * 1024)
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(1)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:input')
})

test('quality decreases only until the practical storage target is reached', async () => {
  const sizes = [700, 600, 450].map(kib => kib * 1024)
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(bytes(sizes.shift() ?? LIMIT + 1)))
  const output = await compressVisitPhoto(bytes(1000, 'image/png'))
  expect(output.size).toBe(450 * 1024)
  expect(output.size).toBeLessThanOrEqual(TARGET)
  expect(vi.mocked(HTMLCanvasElement.prototype.toBlob).mock.calls.map(call => call[2])).toEqual([0.8, 0.7, 0.65])
})

test('JPEG fallback checks actual MIME and follows the same storage target', async () => {
  const sizes = [650, 450].map(kib => kib * 1024)
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback, type) => {
    callback(type === 'image/webp' ? bytes(100, 'image/png') : bytes(sizes.shift()!, 'image/jpeg'))
  })
  const output = await compressVisitPhoto(bytes(1000, 'image/png'))
  expect(output.type).toBe('image/jpeg')
  expect(output.size).toBe(450 * 1024)
  expect(vi.mocked(HTMLCanvasElement.prototype.toBlob).mock.calls.map(call => call[1])).toEqual(['image/webp', 'image/jpeg', 'image/jpeg'])
})

test('target is best-effort and bounded by quality and resolution floors', async () => {
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(bytes(600 * 1024)))
  const output = await compressVisitPhoto(bytes(1000, 'image/png'))
  expect(output.size).toBeGreaterThan(TARGET)
  expect(output.size).toBeLessThanOrEqual(LIMIT)
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(6)
  const drawSizes = drawImage.mock.calls.map(call => call.slice(3))
  expect(drawSizes).toEqual([[1280, 960], [1024, 768]])
  expect(drawImage.mock.calls.every(call => call[0] instanceof Image)).toBe(true)
})

test('oversized output is rejected after bounded attempts, never returned to the preview', async () => {
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(bytes(LIMIT + 1)))
  await expect(compressVisitPhoto(bytes(1000, 'image/png'))).rejects.toThrow('3 MiB')
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(6)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:input')
})

test.each(['null', 'empty', 'wrong-format'])('invalid canvas output is not accepted: %s', async mode => {
  const result = mode === 'null' ? null : mode === 'empty' ? bytes(0) : bytes(100, 'image/png')
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(result))
  await expect(compressVisitPhoto(bytes(1000, 'image/png'))).rejects.toThrow()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:input')
})

test.each([[2400, 1800, 1280, 960], [1800, 2400, 960, 1280], [2400, 2400, 1280, 1280], [640, 480, 640, 480]])('preserves aspect ratio without upscaling %s x %s', async (width, height, outputWidth, outputHeight) => {
  dimensions = { width, height }
  await compressVisitPhoto(bytes(1000, 'image/png'))
  expect(drawImage).toHaveBeenCalledWith(expect.any(Image), 0, 0, outputWidth, outputHeight)
})

test('small-source image is never resized up while seeking the target', async () => {
  dimensions = { width: 640, height: 480 }
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => callback(bytes(600 * 1024)))
  await compressVisitPhoto(bytes(1000, 'image/png'))
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(3)
  expect(drawImage).toHaveBeenCalledTimes(1)
})

test('zero source dimensions fail before encoding', async () => {
  dimensions = { width: 0, height: 0 }
  await expect(compressVisitPhoto(bytes(1000, 'image/png'))).rejects.toThrow()
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled()
})
