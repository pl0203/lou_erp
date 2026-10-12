import { Link } from 'react-router-dom'
import type { LinkProps } from 'react-router-dom'

type Props = LinkProps & { variant?: 'primary' | 'secondary' }

export function ActionLink({ variant = 'primary', className, ...props }: Props) {
  return <Link {...props} className={`ui-action ui-action--${variant}${className ? ` ${className}` : ''}`} />
}
