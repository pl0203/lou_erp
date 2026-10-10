import { useEffect, useState } from 'react'

export default function DocumentPreview({ previews }: { previews: Blob[] }) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const next = previews.map(blob => URL.createObjectURL(blob))
    setUrls(next)
    return () => next.forEach(url => URL.revokeObjectURL(url))
  }, [previews])
  return <div className="min-w-0 space-y-4">
    {urls.map((url, index) => <figure key={url} className="min-w-0">
      <figcaption className="mb-2 text-xs text-gray-500">Halaman {index + 1}</figcaption>
      <img src={url} alt={`Pratinjau dokumen halaman ${index + 1}`} className="max-w-full h-auto rounded border border-gray-200" />
    </figure>)}
  </div>
}
