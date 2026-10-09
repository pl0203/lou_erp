type BrandLogoProps = {
  variant?: 'lockup' | 'mark'
  decorative?: boolean
  className?: string
}

export default function BrandLogo({ variant = 'lockup', decorative = false, className = '' }: BrandLogoProps) {
  const isMark = variant === 'mark'
  return (
    <img
      src={isMark ? '/brand/padiwan-mark.svg' : '/brand/padiwan-logo.svg'}
      alt={decorative ? '' : 'Padiwan'}
      aria-hidden={decorative || undefined}
      width={isMark ? 512 : 474}
      height={isMark ? 512 : 104}
      className={`${isMark ? 'h-8 w-8 shrink-0' : 'h-auto w-52 max-w-full'} ${className}`.trim()}
    />
  )
}
