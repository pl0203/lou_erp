import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, matchPath, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import BrandLogo from './BrandLogo'
import NavigationIcon from './NavigationIcon'
import { moduleIcons, moduleLabels, moduleOptions, roleHome } from './navigationModules'
import type { NavigationGroup, NavigationItem, NavigationLink, NavigationModule } from './navigationModules'
import './navigation.css'

const COLLAPSED_KEY = 'padiwan.navigation.collapsed'
function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === 'true' } catch { return false }
}
function useMobileNavigation() {
  const [mobile, setMobile] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 1023px)').matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const media = matchMedia('(max-width: 1023px)')
    const change = () => setMobile(media.matches)
    const onChange = (event: MediaQueryListEvent) => setMobile(event.matches)
    change()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return mobile
}

function MobileDrawer({ children, onClose, opener }: { children: ReactNode; onClose: () => void; opener: React.RefObject<HTMLButtonElement | null> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useLayoutEffect(() => {
    const node = dialog.current!
    if (typeof node.showModal === 'function') node.showModal()
    else node.setAttribute('open', '')
    node.querySelector<HTMLButtonElement>('button')?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      if (typeof node.close === 'function' && node.open) node.close()
      document.body.style.overflow = overflow
      if (opener.current?.isConnected) opener.current.focus()
    }
  }, [opener])
  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') { event.preventDefault(); close.current(); return }
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialog.current!.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex="0"]'))
    const first = focusable[0], last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  return <dialog ref={dialog} aria-label="Menu utama" aria-modal="true" className="navigation-drawer" onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={onKeyDown} onClick={event => {
    if (event.target !== event.currentTarget) return
    const box = event.currentTarget.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose()
  }}>{children}</dialog>
}

function linkIsActive(link: NavigationLink, location: { pathname: string; search: string }) {
  if (link.activeExcludePaths?.some(path => matchPath({ path, end: false }, location.pathname))) return false
  if (!(link.activePaths ?? [link.to.split('?')[0]]).some(path => matchPath({ path, end: false }, location.pathname))) return false
  if (!link.activeSearch) return true
  const { key, value, fallback, allowed } = link.activeSearch
  const selected = new URLSearchParams(location.search).get(key)
  return (selected !== null && allowed.includes(selected) ? selected : fallback) === value
}

function NavigationGroupLinks({ group, location, compact, onExpand, renderLink, tooltipEvents }: {
  group: NavigationGroup; location: ReturnType<typeof useLocation>; compact: boolean
  onExpand: () => void; renderLink: (link: NavigationLink) => ReactNode
  tooltipEvents: (text: string) => Record<string, unknown>
}) {
  const active = group.children.some(link => linkIsActive(link, location))
  const [open, setOpen] = useState(active)
  const childrenId = useId()
  useEffect(() => { if (active) setOpen(true) }, [active, location.key])
  return <div className="navigation-group">
    <button type="button" aria-label={group.label} aria-expanded={!compact && open} aria-controls={childrenId}
      className={`navigation-link navigation-group-toggle ${active ? 'navigation-group-active' : ''}`}
      onClick={() => { if (compact) { onExpand(); setOpen(true) } else setOpen(value => !value) }} {...tooltipEvents(group.label)}>
      <NavigationIcon name={group.icon} /><span className="navigation-label">{group.label}</span>
      <NavigationIcon name="chevron" className={`navigation-label navigation-chevron ${open ? 'navigation-chevron-open' : ''}`} />
    </button>
    {!compact && open && <div id={childrenId} role="group" aria-label={`Submenu ${group.label}`} className="navigation-submenu">
      {group.children.map(renderLink)}
    </div>}
  </div>
}

export default function AppNavigation({ module, links, beforeSignOut }: { module: NavigationModule; links: NavigationItem[]; beforeSignOut?: () => boolean }) {
  const { profile, signOut } = useAuth()
  const location = useLocation()
  const mobile = useMobileNavigation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showUser, setShowUser] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const [tooltip, setTooltip] = useState<{ label: string; left: number; top: number } | null>(null)
  const switcherRef = useRef<HTMLDivElement>(null), userRef = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const switcherTrigger = useRef<HTMLButtonElement>(null), accountTrigger = useRef<HTMLButtonElement>(null)
  const navId = useId(), switcherId = useId(), accountId = useId()
  const compact = collapsed && !mobile
  const label = moduleLabels[module]
  const options = moduleOptions(profile?.role)
  const initials = profile?.full_name?.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase() || '?'

  function closeMenus() { setShowSwitcher(false); setShowUser(false); setTooltip(null) }
  function closeDrawer() { setMobileOpen(false); closeMenus() }
  useEffect(() => { closeDrawer() }, [location.key, mobile])
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (!switcherRef.current?.contains(event.target as Node)) setShowSwitcher(false)
      if (!userRef.current?.contains(event.target as Node)) setShowUser(false)
    }
    function dismiss(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setTooltip(null)
    }
    function clearTooltip() { setTooltip(null) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', dismiss)
    window.addEventListener('scroll', clearTooltip, true)
    window.addEventListener('resize', clearTooltip)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', dismiss)
      window.removeEventListener('scroll', clearTooltip, true)
      window.removeEventListener('resize', clearTooltip)
    }
  }, [])
  function toggleCollapsed() {
    closeMenus()
    setCollapsed(value => {
      const next = !value
      try { localStorage.setItem(COLLAPSED_KEY, String(next)) } catch { /* Navigation works when storage is disabled. */ }
      return next
    })
  }
  function hint(text: string, target: HTMLElement) {
    if (!compact || showSwitcher || showUser) return
    const box = target.getBoundingClientRect()
    setTooltip({ label: text, left: box.right + 10, top: Math.min(Math.max(box.top + box.height / 2, 20), window.innerHeight - 20) })
  }
  function tooltipEvents(text: string) {
    return {
      onMouseEnter: (event: MouseEvent<HTMLElement>) => hint(text, event.currentTarget),
      onMouseLeave: () => setTooltip(null),
      onFocus: (event: React.FocusEvent<HTMLElement>) => hint(text, event.currentTarget),
      onBlur: () => setTooltip(null),
    }
  }
  function closeAfterNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) closeDrawer()
  }
  async function handleSignOut() {
    if (signingOut || (beforeSignOut && !beforeSignOut())) return
    setSigningOut(true); setSignOutError('')
    try { if (await signOut()) closeDrawer() /* ProtectedRoute owns the auth redirect. */ }
    catch { setSignOutError('Tidak dapat keluar. Silakan coba lagi.') }
    finally { setSigningOut(false) }
  }
  function onPopoverKeyDown(event: KeyboardEvent, open: boolean, trigger: React.RefObject<HTMLButtonElement | null>, dismiss: () => void) {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault(); event.stopPropagation(); dismiss()
    trigger.current?.focus()
  }

  function expandSidebar() {
    closeMenus(); setCollapsed(false)
    try { localStorage.setItem(COLLAPSED_KEY, 'false') } catch { /* Navigation still opens without storage. */ }
  }
  function renderLink(link: NavigationLink) {
    const active = linkIsActive(link, location)
    return <Link key={link.to} to={link.to} aria-current={active ? 'page' : undefined}
      aria-label={link.badge && link.badge > 0 ? `${link.label}, ${link.badge} menunggu` : link.label}
      className={`navigation-link ${active ? 'navigation-link-active' : ''}`} onClick={closeAfterNavigation} {...tooltipEvents(link.label)}>
      <NavigationIcon name={link.icon} /><span className="navigation-label">{link.label}</span>
      {!!link.badge && link.badge > 0 && <span aria-hidden="true" className="navigation-badge">{link.badge > 99 ? '99+' : link.badge}</span>}
    </Link>
  }
  const menu = <>
    <div className="navigation-toolbar">
      <button type="button" className="navigation-toggle" aria-label={mobile ? 'Tutup menu' : compact ? 'Buka menu' : 'Minimalkan menu'} aria-expanded={mobile ? true : !collapsed} aria-controls={navId} onClick={mobile ? closeDrawer : toggleCollapsed} {...tooltipEvents('Buka menu')}>
        <NavigationIcon name={mobile ? 'close' : 'menu'} />
      </button>
      <BrandLogo className="navigation-wordmark" />
    </div>
    <div className="navigation-module" ref={switcherRef} onKeyDown={event => onPopoverKeyDown(event, showSwitcher, switcherTrigger, () => setShowSwitcher(false))}>
      {module === 'home' ? <div className="navigation-module-home"><BrandLogo variant="mark" decorative /><span className="navigation-label">Semua modul</span></div> : <button ref={switcherTrigger} type="button" className="navigation-module-button" aria-label={label} aria-expanded={showSwitcher} aria-controls={switcherId} onClick={() => { setShowSwitcher(value => !value); setShowUser(false); setTooltip(null) }} {...tooltipEvents(label)}>
        <NavigationIcon name={moduleIcons[module]} /><span className="navigation-label">{label}</span><NavigationIcon name="chevron" className="navigation-label navigation-chevron" />
      </button>}
      {showSwitcher && <div id={switcherId} role="group" aria-label="Pilihan modul" className="navigation-popover navigation-module-options">
        <p className="navigation-popover-title">Ganti modul</p>
        {options.map(option => <Link key={option.to} to={option.to} onClick={closeAfterNavigation} className="navigation-module-option"><NavigationIcon name={option.icon} /><span><strong>{option.label}</strong><small>{option.description}</small></span></Link>)}
      </div>}
    </div>
    <nav id={navId} aria-label={`Navigasi ${label}`} className="navigation-links">
      {links.map(item => 'children' in item
        ? <NavigationGroupLinks key={item.id} group={item} location={location} compact={compact} onExpand={expandSidebar} renderLink={renderLink} tooltipEvents={tooltipEvents} />
        : renderLink(item))}
    </nav>
    <div className="navigation-account" ref={userRef} onKeyDown={event => onPopoverKeyDown(event, showUser, accountTrigger, () => setShowUser(false))}>
      <button ref={accountTrigger} type="button" className="navigation-user-button" aria-label="Menu pengguna" aria-expanded={showUser} aria-controls={accountId} onClick={() => { setShowUser(value => !value); setShowSwitcher(false); setTooltip(null) }} {...tooltipEvents('Menu pengguna')}>
        <span className="navigation-avatar" aria-hidden="true">{initials}</span><span className="navigation-label navigation-user-name"><strong>{profile?.full_name}</strong><small>{profile?.role?.replace(/_/g, ' ')}</small></span><NavigationIcon name="chevron" className="navigation-label navigation-chevron" />
      </button>
      {showUser && <div id={accountId} role="group" aria-label="Akun pengguna" className="navigation-popover navigation-account-options">
        <div className="navigation-account-info"><strong>{profile?.full_name}</strong><small>{profile?.role?.replace(/_/g, ' ')}</small></div>
        <Link to={roleHome(profile?.role)} onClick={closeAfterNavigation}><NavigationIcon name="home" /><span>{profile?.role === 'executive' ? 'Ganti modul' : 'Kembali ke modul'}</span></Link>
        <button type="button" onClick={() => void handleSignOut()} disabled={signingOut} className="navigation-sign-out"><NavigationIcon name="logout" /><span>{signingOut ? 'Keluar…' : 'Keluar'}</span></button>
        {signOutError && <p role="alert" className="navigation-sign-out-error">{signOutError}</p>}
      </div>}

    </div>
  </>

  return <div className="app-navigation" data-collapsed={compact}>
    <a href="#main-content" className="ui-skip-link" onClick={event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
      // A page owns this explicit target; navigation never discovers or moves
      // page content, changes routes, or creates an additional main landmark.
      document.getElementById('main-content')?.focus()
    }}>Lewati ke konten utama</a>
    {mobile ? <>
      <header className="navigation-mobile-header"><button ref={opener} type="button" className="navigation-toggle" aria-label="Buka menu" aria-expanded={mobileOpen} aria-controls={navId} onClick={() => setMobileOpen(true)}><NavigationIcon name="menu" /></button><BrandLogo variant="mark" decorative /><span>{label}</span></header>
      {mobileOpen && <MobileDrawer onClose={closeDrawer} opener={opener}>{menu}</MobileDrawer>}
    </> : <aside aria-label="Menu utama" className="navigation-sidebar">{menu}</aside>}
    {tooltip && createPortal(<div role="tooltip" className="navigation-tooltip" style={{ left: tooltip.left, top: tooltip.top }}>{tooltip.label}</div>, document.body)}
  </div>
}
