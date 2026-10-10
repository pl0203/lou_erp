export default function ReadFailure({ onRetry }: { onRetry: () => void }) {
  return <div role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
    <p>Gagal memuat data lengkap. Coba lagi sebelum melanjutkan.</p>
    <button type="button" onClick={onRetry} className="mt-2 underline">Coba lagi</button>
  </div>
}
