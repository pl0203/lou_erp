import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cacheProbe } from './scalability/cache-probe'
const state = vi.hoisted(() => ({ checkIn: vi.fn(), imageFailure: false }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {}, useParams: () => ({ scheduleId: 's' }) }))
vi.mock('../src/lib/useUnsavedChanges', () => ({ hasOrderItemChanges: () => false, useUnsavedChanges: () => ({ dialog: null, runWithoutPrompt: (action: () => void) => action() }) }))
vi.mock('../src/components/GirardNav', () => ({ default: () => null }))
vi.mock('../src/lib/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u' } }) }))
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/lib/visitCheckIn', () => ({ createVisitCheckIn: () => state.checkIn }))
vi.mock('@tanstack/react-query', async original => ({ ...await original<any>(), useQuery: ({ queryKey }: any) => ({ data: queryKey[0] === 'schedule' ? { id: 's', customers: { id: 'c', name: 'Customer', pricing_tier: 'luar_kota' } } : queryKey[0] === 'visit' ? null : [] }) }))
import VisitPage from '../src/pages/girard/VisitPage'
const media = vi.fn()
const stop = vi.fn()
const stream = { getTracks: () => [{ stop }], removeTrack: () => {} } as unknown as MediaStream
const clients: QueryClient[] = []
beforeEach(() => {
  media.mockReset().mockResolvedValue(stream); stop.mockClear(); state.imageFailure = false; state.checkIn.mockReset()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: media } })
  vi.stubGlobal('Image', class { width = 640; height = 480; onload?: () => void; onerror?: (error: Error) => void; set src(_: string) { queueMicrotask(() => state.imageFailure ? this.onerror?.(new Error('Image failed')) : this.onload?.()) } })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test-photo'), revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(480)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as any)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['photo'], { type: 'image/webp' })))
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function mount() { const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }); clients.push(client); return render(<QueryClientProvider client={client}><VisitPage /></QueryClientProvider>) }
async function openCamera() {
  fireEvent.click(screen.getByRole('button', { name: /Ketuk untuk membuka kamera/ }))
  await waitFor(() => expect(document.querySelector('video')?.srcObject).toBe(stream))
  fireEvent.loadedData(document.querySelector('video')!)
}

test('permission denial followed by a successful retry clears the old error and attaches live video', async () => {
  media.mockRejectedValueOnce(new Error('denied')).mockResolvedValue(stream)
  mount(); fireEvent.click(screen.getByRole('button', { name: /Ketuk untuk membuka kamera/ }))
  await screen.findByText(/Akses kamera ditolak/)
  fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
  await waitFor(() => expect(media).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByText(/Akses kamera ditolak/)).toBeNull())
  expect(document.querySelector('video')?.srcObject).toBe(stream)
})

test('cancel stops the current camera and reopening requests a fresh stream', async () => {
  mount(); await openCamera()
  fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
  expect(stop).toHaveBeenCalledTimes(1)
  await openCamera()
  expect(media).toHaveBeenCalledTimes(2)
})

test('a stream resolving after camera cancellation is stopped instead of retained', async () => {
  let grant!: (value: MediaStream) => void
  media.mockReturnValueOnce(new Promise(resolve => { grant = resolve }))
  mount(); fireEvent.click(screen.getByRole('button', { name: /Ketuk untuk membuka kamera/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
  await act(async () => grant(stream))
  expect(stop).toHaveBeenCalledTimes(1)
  expect(document.querySelector('video')).toBeNull()
})

test('capture stops camera and a failed upload keeps the same photo available for retry', async () => {
  state.checkIn.mockRejectedValueOnce(new Error('Upload gagal')).mockResolvedValue({ id: 'v' })
  mount(); await openCamera()
  const probe = cacheProbe(clients.at(-1)!)
  window.localStorage.setItem('pilot-upload:u:s', 'pending-upload')
  fireEvent.click(screen.getByRole('button', { name: 'Ambil foto' }))
  await screen.findByText('Foto berhasil diambil')
  expect(stop).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: /Konfirmasi Check-in/ }))
  await screen.findByText('Upload gagal')
  probe.unchanged()
  expect(window.localStorage.getItem('pilot-upload:u:s')).toBe('pending-upload')
  expect(screen.getByAltText('Foto check-in')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Konfirmasi Check-in/ }))
  await waitFor(() => expect(state.checkIn).toHaveBeenCalledTimes(2))
  expect(state.checkIn.mock.calls[0][0].photo_blob).toBe(state.checkIn.mock.calls[1][0].photo_blob)
  await waitFor(() => probe.refreshed())
  expect(window.localStorage.getItem('pilot-upload:u:s')).toBeNull()
  expect(screen.queryByAltText('Foto check-in')).toBeNull()
  probe.stop()
})

test('compression failure exits busy state and offers a retry without an unhandled rejection', async () => {
  state.imageFailure = true
  mount(); await openCamera()
  fireEvent.click(screen.getByRole('button', { name: 'Ambil foto' }))
  expect(await screen.findByText('Foto gagal diproses. Coba ambil foto lagi.')).toBeTruthy()
  expect(screen.queryByText('Mengambil foto...')).toBeNull()
})

test.each(['drawImage', 'toBlob'])('a thrown compression %s exits busy state and the next capture can succeed', async stage => {
  if (stage === 'drawImage') {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({ drawImage: vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('Canvas failed') }) } as any)
  } else {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(callback => callback(new Blob(['raw'], { type: 'image/webp' }))).mockImplementationOnce(() => { throw new Error('Canvas failed') })
  }
  mount(); await openCamera()
  fireEvent.click(screen.getByRole('button', { name: 'Ambil foto' }))
  await screen.findByText('Foto gagal diproses. Coba ambil foto lagi.')
  expect(screen.queryByText('Mengambil foto...')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }))
  await waitFor(() => expect(media).toHaveBeenCalledTimes(2))
  fireEvent.loadedData(document.querySelector('video')!)
  fireEvent.click(screen.getByRole('button', { name: 'Ambil foto' }))
  expect(await screen.findByText('Foto berhasil diambil')).toBeTruthy()
})


test('a browser returning PNG for requested WebP captures a JPEG photo for check-in', async () => {
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((callback, type) => {
    callback(new Blob(['photo'], { type: type === 'image/jpeg' ? 'image/jpeg' : 'image/png' }))
  })
  state.checkIn.mockRejectedValue(new Error('Keep preview for inspection'))
  mount(); await openCamera()
  fireEvent.click(screen.getByRole('button', { name: 'Ambil foto' }))
  await screen.findByText('Foto berhasil diambil')
  fireEvent.click(screen.getByRole('button', { name: /Konfirmasi Check-in/ }))
  await waitFor(() => expect(state.checkIn).toHaveBeenCalledTimes(1))
  expect(state.checkIn.mock.calls[0][0].photo_blob.type).toBe('image/jpeg')
})


test('cancelling while compression is pending never publishes the late photo', async () => {
  let finishCompression!: BlobCallback
  vi.mocked(HTMLCanvasElement.prototype.toBlob)
    .mockImplementationOnce(callback => callback(new Blob(['raw'], { type: 'image/png' })))
    .mockImplementationOnce(callback => { finishCompression = callback })
  mount(); await openCamera()
  fireEvent.click(screen.getByRole('button', { name: 'Ambil foto' }))
  await waitFor(() => expect(finishCompression).toBeTypeOf('function'))
  fireEvent.click(screen.getByRole('button', { name: 'Batal' }))
  await act(async () => finishCompression(new Blob(['photo'], { type: 'image/webp' })))
  expect(screen.queryByAltText('Foto check-in')).toBeNull()
  expect(screen.queryByText('Foto berhasil diambil')).toBeNull()
  expect(stop).toHaveBeenCalledTimes(1)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-photo')
  expect(state.checkIn).not.toHaveBeenCalled()
})

test('repeated capture while compression is pending processes only one photo', async () => {
  let finishCompression!: BlobCallback
  vi.mocked(HTMLCanvasElement.prototype.toBlob)
    .mockImplementationOnce(callback => callback(new Blob(['raw'], { type: 'image/png' })))
    .mockImplementationOnce(callback => { finishCompression = callback })
  mount(); await openCamera()
  const capture = screen.getByRole('button', { name: 'Ambil foto' })
  fireEvent.click(capture)
  await waitFor(() => expect(finishCompression).toBeTypeOf('function'))
  fireEvent.click(capture)
  expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(2)
  await act(async () => finishCompression(new Blob(['photo'], { type: 'image/webp' })))
  expect(await screen.findByText('Foto berhasil diambil')).toBeTruthy()
  expect(stop).toHaveBeenCalledTimes(1)
})
