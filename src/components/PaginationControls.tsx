type Props = { page: number; total: number; pageSize: number; pending: boolean; onPageChange: (page: number) => void }

export default function PaginationControls({ page, total, pageSize, pending, onPageChange }: Props) {
  const last = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500" aria-busy={pending}>
    <div><p>{start}–{end} dari {total}</p>{pending && <p role="status" className="mt-1 text-xs text-blue-600">Memperbarui data… Menampilkan hasil sebelumnya sampai selesai.</p>}</div>
    <nav aria-label="Halaman hasil" className="flex min-w-0 flex-wrap items-center gap-3">
      <button type="button" disabled={pending || page <= 1} onClick={() => onPageChange(page - 1)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40">Sebelumnya</button>
      <span>Halaman {page} dari {last}</span>
      <button type="button" disabled={pending || page >= last} onClick={() => onPageChange(page + 1)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40">Berikutnya</button>
    </nav>
  </div>
}
