import { Button } from './ui/Button'

type Props = { page: number; total: number; pageSize: number; pending: boolean; onPageChange: (page: number) => void }

export default function PaginationControls({ page, total, pageSize, pending, onPageChange }: Props) {
  const last = Math.ceil(total / pageSize)
  const displayedPage = total === 0 ? 0 : page
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)
  return <div className="ui-pagination" aria-busy={pending}>
    <div><p>{start}–{end} dari {total}</p>{pending && <p role="status" className="ui-pagination__status">Memperbarui data… Menampilkan hasil sebelumnya sampai selesai.</p>}</div>
    <nav aria-label="Halaman hasil" className="flex min-w-0 flex-wrap items-center gap-3">
      <Button variant="secondary" disabled={pending || total === 0 || page <= 1} onClick={() => onPageChange(page - 1)}>Sebelumnya</Button>
      <span>Halaman {displayedPage} dari {last}</span>
      <Button variant="secondary" disabled={pending || total === 0 || page >= last} onClick={() => onPageChange(page + 1)}>Berikutnya</Button>
    </nav>
  </div>
}
