import type { HTMLAttributes } from 'react'

// Each page owner mounts this once, after navigation, in place of its content
// root. It must not be nested inside another main landmark.
type Props = Omit<HTMLAttributes<HTMLElement>, 'id' | 'tabIndex'>

export function MainContent({ className, ...props }: Props) {
  return <main {...props} id="main-content" tabIndex={-1} className={`ui-main-content${className ? ` ${className}` : ''}`} />
}
