import { LIMITS, POReaderError, readerError } from './limits'

const FORMATS = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const
const invalid = () => { throw readerError('INVALID_SIGNATURE') }
function dimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) invalid()
  if (width * height > LIMITS.pixels) throw readerError('TOO_MANY_PIXELS')
}
const tag = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length))
function pngHeader(bytes: Uint8Array) {
  if (bytes.length < 45 || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) invalid()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(8) !== 13 || tag(bytes, 12, 4) !== 'IHDR') invalid()
  dimensions(view.getUint32(16), view.getUint32(20))
  let offset = 8, ended = false, image = false
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset), name = tag(bytes, offset + 4, 4)
    if (size > bytes.length - offset - 12) invalid()
    if (name === 'acTL' || name === 'fcTL' || name === 'fdAT') throw readerError('ANIMATED_IMAGE')
    if (offset !== 8 && name === 'IHDR') invalid()
    if (name === 'IDAT') image = true
    offset += size + 12
    if (name === 'IEND') { if (size !== 0) invalid(); ended = true; break }
  }
  if (!ended || !image || offset !== bytes.length) invalid()
}
function jpegHeader(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) invalid()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2, found = false
  const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf])
  while (offset + 1 < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid()
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x00 || marker === 0xd8) invalid()
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > bytes.length) invalid()
    const size = view.getUint16(offset)
    if (size < 2 || offset + size > bytes.length) invalid()
    if (sof.has(marker)) {
      if (size < 8) invalid()
      dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3)); found = true
    }
    // JPEG's MPF container can hold multiple images. Reject instead of choosing one.
    if (marker === 0xe2 && tag(bytes, offset + 2, 4) === 'MPF\0') throw readerError('ANIMATED_IMAGE')
    offset += size
  }
  if (!found) invalid()
}
function webpHeader(bytes: Uint8Array) {
  if (bytes.length < 20 || tag(bytes, 0, 4) !== 'RIFF' || tag(bytes, 8, 4) !== 'WEBP') invalid()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(4, true) + 8 !== bytes.length) invalid()
  let offset = 12, found = false
  while (offset + 8 <= bytes.length) {
    const name = tag(bytes, offset, 4), size = view.getUint32(offset + 4, true), data = offset + 8
    if (size > bytes.length - data) invalid()
    if (name === 'ANIM' || name === 'ANMF') throw readerError('ANIMATED_IMAGE')
    if (name === 'VP8X') {
      if (size !== 10) invalid()
      if (bytes[data] & 2) throw readerError('ANIMATED_IMAGE')
      const read24 = (n: number) => bytes[n] + bytes[n+1]*256 + bytes[n+2]*65536
      dimensions(read24(data + 4) + 1, read24(data + 7) + 1); found = true
    } else if (name === 'VP8 ') {
      if (size < 10 || bytes[data+3] !== 0x9d || bytes[data+4] !== 1 || bytes[data+5] !== 0x2a) invalid()
      dimensions(view.getUint16(data+6,true) & 0x3fff, view.getUint16(data+8,true) & 0x3fff); found = true
    } else if (name === 'VP8L') {
      if (size < 5 || bytes[data] !== 0x2f) invalid()
      const bits = view.getUint32(data+1,true)
      dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1); found = true
    }
    offset = data + size + (size & 1)
  }
  if (!found || offset !== bytes.length) invalid()
}

/** Check the entire bounded container before any native image decoding. */
export async function validatePOFile(file: File): Promise<{ kind: 'pdf' | 'image' }> {
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 || /[\u0000-\u001f\u007f]/u.test(file.name)) invalid()
  if (file.size > LIMITS.bytes) throw readerError('TOO_LARGE')
  const extension = file.name.toLowerCase().split('.').pop() ?? ''
  if (!Object.hasOwn(FORMATS, extension)) throw readerError('UNSUPPORTED_TYPE')
  const mime = FORMATS[extension as keyof typeof FORMATS]
  if (file.type && file.type.toLowerCase() !== mime) invalid()
  let bytes: Uint8Array | undefined
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
    if (!bytes.length) invalid()
    if (bytes.length > LIMITS.bytes) throw readerError('TOO_LARGE')
    if (extension === 'pdf') {
      if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\s|$)/u.test(tag(bytes, 0, Math.min(16, bytes.length)))) invalid()
      return { kind: 'pdf' }
    }
    if (extension === 'png') pngHeader(bytes)
    else if (extension === 'webp') webpHeader(bytes)
    else jpegHeader(bytes)
    return { kind: 'image' }
  } catch (error) {
    // Validation failures contain only fixed messages. File reading errors must not escape.
    if (error instanceof POReaderError) throw error
    throw readerError('INVALID_SIGNATURE')
  } finally { bytes?.fill(0) }
}
