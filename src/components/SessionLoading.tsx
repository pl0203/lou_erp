import BrandLogo from './BrandLogo'
import { MainContent } from './ui/MainContent'

/** Neutral session restoration only. Never displays private content or fake progress. */
export default function SessionLoading() {
  return <MainContent className="min-h-screen bg-brand-canvas flex items-center justify-center px-6 py-8">
    <div className="flex flex-col items-center gap-5 text-center">
      <BrandLogo variant="mark" className="!h-12 !w-12" />
      <div role="status" aria-live="polite" aria-atomic="true" className="flex items-center gap-3 text-sm text-brand-secondary">
        <span className="ui-action__pending" aria-hidden="true" />
        <span>Memeriksa sesi…</span>
      </div>
    </div>
  </MainContent>
}
