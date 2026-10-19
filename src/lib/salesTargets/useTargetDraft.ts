import { useMemo, useSyncExternalStore } from 'react'
import type { TargetBaseline, TargetLine, TargetPlan } from './contracts'
import type { TargetCommandRecovery } from './recovery'
export type TargetDraft = { month: string; managerId: string; step: 1 | 2 | 3; baseline: TargetBaseline | null; lines: TargetLine[]; plan: TargetPlan | null; dirty: boolean }
export type TargetDraftSession = {
  get(): TargetDraft
  update(patch: Partial<TargetDraft>): void
  subscribe(listener: () => void): () => void
  current(): boolean
  recovery?: TargetCommandRecovery
}
/** Tab-memory only. Never stores customer/target data in browser persistence. */
export class TargetDraftStore {
  private identity: string | null = null
  private epoch = 0
  private sessions = new Map<string, TargetDraftSession>()
  clear() { this.identity = null; this.epoch++; this.sessions.clear() }
  remember(identity: string, key: string, session: TargetDraftSession) {
    if (this.identity !== identity || !session.current()) return
    for (const [alias, value] of this.sessions) if (value === session && alias !== key) this.sessions.delete(alias)
    this.sessions.set(key, session)
  }
  open(identity: string, key: string, initial: TargetDraft): TargetDraftSession {
    if (this.identity !== identity) { this.clear(); this.identity = identity }
    const existing = this.sessions.get(key)
    if (existing) return existing
    const epoch = this.epoch, listeners = new Set<() => void>()
    let value = structuredClone(initial)
    const current = () => this.identity === identity && this.epoch === epoch
    const session: TargetDraftSession = {
      current, get: () => value,
      update: patch => { if (!current()) return; value = { ...value, ...patch }; listeners.forEach(listener => listener()) },
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
    this.sessions.set(key, session)
    return session
  }
}
const drafts = new TargetDraftStore()
export function clearTargetDrafts() { drafts.clear() }
export function useTargetDraft(identity: string, key: string, initial: TargetDraft) {
  // The identity contains backend, verified actor and role. An auth change invalidates late responses too.
  const session = useMemo(() => drafts.open(identity, key, initial), [identity, key])
  const draft = useSyncExternalStore(session.subscribe, session.get, session.get)
  return { session, draft, update: session.update, remember: (key: string) => drafts.remember(identity, key, session) }
}
