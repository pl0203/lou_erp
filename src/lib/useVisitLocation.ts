import { useCallback, useEffect, useRef, useState } from 'react'

type Coordinates = { lat: number; lng: number }
type LocationState = { scope: string | null; status: 'idle' | 'loading' | 'granted' | 'unavailable'; location: Coordinates | null }
type Session = { scope: string; active: boolean; pending: boolean; attempted: boolean; generation: number; state: LocationState }

/** One position per eligible check-in form. Coordinates remain in memory until its existing save. */
export function useVisitLocation(scope: string | null, enabled = true) {
  const session = useRef<Session | null>(null)
  const [state, setState] = useState<LocationState>({ scope: null, status: 'idle', location: null })

  const request = useCallback((current: Session) => {
    if (!current.active || current.pending) return
    current.pending = true
    current.attempted = true
    const generation = ++current.generation
    const isCurrent = () => current.active && current.generation === generation
    const publish = (next: LocationState) => { current.state = next; setState(next) }
    publish({ scope: current.scope, status: 'loading', location: null })
    const unavailable = () => {
      if (!isCurrent()) return
      current.pending = false
      publish({ scope: current.scope, status: 'unavailable', location: null })
    }
    try {
      if (!navigator.geolocation) { unavailable(); return }
      navigator.geolocation.getCurrentPosition(position => {
        if (!isCurrent()) return
        const { latitude: lat, longitude: lng } = position.coords
        if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) { unavailable(); return }
        current.pending = false
        publish({ scope: current.scope, status: 'granted', location: { lat, lng } })
      }, unavailable, { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 })
    } catch { unavailable() }
  }, [])

  useEffect(() => {
    if (!scope) { session.current = null; setState({ scope: null, status: 'idle', location: null }); return }
    const current: Session = session.current?.scope === scope ? session.current : {
      scope, active: false, pending: false, attempted: false, generation: 0,
      state: { scope, status: 'idle', location: null },
    }
    current.active = enabled
    const generation = ++current.generation
    session.current = current
    if (enabled && !current.attempted) current.state = { scope, status: 'loading', location: null }
    setState(current.state)
    // React StrictMode's immediate setup/cleanup cycle cancels the first queued
    // request before it can open a browser permission prompt.
    queueMicrotask(() => { if (current.active && current.generation === generation && !current.attempted) request(current) })
    return () => {
      current.active = false
      current.generation++
      if (current.pending) current.state = { scope, status: 'unavailable', location: null }
      current.pending = false
    }
  }, [scope, enabled, request])

  const retry = useCallback(() => { if (session.current) request(session.current) }, [request])
  // Freeze the submitted snapshot before upload starts. Late GPS must not alter
  // the coordinates used by an idempotent retry after an ambiguous outcome.
  const freeze = useCallback(() => {
    const current = session.current
    if (!current || current.scope !== scope) return null
    current.generation++; current.pending = false; current.attempted = true
    if (current.state.status !== 'granted') current.state = { scope: current.scope, status: 'unavailable', location: null }
    setState(current.state)
    return current.state.location
  }, [scope])
  const clear = useCallback(() => {
    const current = session.current
    const next: LocationState = { scope: current?.scope ?? null, status: 'unavailable', location: null }
    if (current) { current.generation++; current.pending = false; current.attempted = true; current.state = next }
    setState(next)
  }, [])
  // Do not expose a previous schedule's coordinates even before effect cleanup.
  const visible = state.scope === scope ? state : { scope, status: scope ? 'loading' as const : 'idle' as const, location: null }
  return { location: visible.location, status: visible.status, retry, freeze, clear }
}
