import { Button } from './ui/Button'
import { Notice } from './ui/Feedback'

export default function ReadFailure({ onRetry }: { onRetry: () => void }) {
  return <Notice tone="error" className="m-4" title="Gagal memuat data lengkap. Coba lagi sebelum melanjutkan."
    actions={<Button variant="secondary" onClick={onRetry}>Coba lagi</Button>} />
}
