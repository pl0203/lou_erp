import { Link } from 'react-router-dom'
import type { LinkProps } from 'react-router-dom'

type Props = LinkProps & {
  variant?: 'primary' | 'secondary' | 'quiet'
  size?: 'default' | 'compact'
}

export function ActionLink({ variant = 'primary', size = 'default', className, ...props }: Props) {
  return <Link {...props} className={`ui-action ui-action--${variant}${size === 'compact' ? ' ui-action--compact' : ''}${className ? ` ${className}` : ''}`} />
}
