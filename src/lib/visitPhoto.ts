export const MAX_VISIT_PHOTO_BYTES = 3 * 1024 * 1024
const TARGET_PHOTO_BYTES = 500 * 1024
const QUALITY_STEPS = [0.8, 0.7, 0.65]

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(result => {
      if (result && result.size > 0) resolve(result)
      else reject(new Error('Kompresi gagal'))
    }, type, quality)
  })
}

/** Prefer small evidence photos, but never sacrifice quality below these floors. */
export async function compressVisitPhoto(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Foto gagal diproses'))
      img.src = url
    })
    const { width, height } = img
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Ukuran foto tidak valid')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas tidak didukung')
    // At most six encodes, plus one JPEG fallback probe. Never upscale a small
    // source or repeatedly decode/recompress the previous lossy result.
    const longestEdge = Math.max(width, height)
    const edges = [...new Set([Math.min(longestEdge, 1280), Math.min(longestEdge, 1024)])]
    let type = 'image/webp'
    let smallest: Blob | null = null
    for (const edge of edges) {
      canvas.width = Math.max(1, Math.round(width * edge / longestEdge))
      canvas.height = Math.max(1, Math.round(height * edge / longestEdge))
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      for (const quality of QUALITY_STEPS) {
        let result = await encode(canvas, type, quality)
        // Safari can return PNG when WebP encoding is unavailable. The requested
        // MIME is only a preference; trust the returned Blob and retry as JPEG.
        if (type === 'image/webp' && result.type !== type) {
          type = 'image/jpeg'
          result = await encode(canvas, type, quality)
        }
        if (result.type !== type) throw new Error('Format foto tidak didukung browser')
        if (!smallest || result.size < smallest.size) smallest = result
        if (result.size <= TARGET_PHOTO_BYTES) return result
      }
    }
    // 500 KiB is an optimization target, not a reason to reject usable evidence.
    if (smallest && smallest.size <= MAX_VISIT_PHOTO_BYTES) return smallest
    throw new Error('Foto masih melebihi 3 MiB. Coba ambil foto lagi.')
  } finally {
    URL.revokeObjectURL(url)
  }
}
