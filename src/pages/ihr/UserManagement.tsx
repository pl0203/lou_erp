import { LoadingState } from '../../components/ui/LoadingState'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import IHRNav from '../../components/IHRNav'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Field } from '../../components/ui/Field'
import { FilterBar } from '../../components/ui/FilterBar'
import { FormActions } from '../../components/ui/FormActions'
import { MainContent } from '../../components/ui/MainContent'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState, Notice, StatusBadge } from '../../components/ui/Feedback'

type UserProfile = {
  id: string
  full_name: string
  email: string
  role: string
  phone: string | null
  birth_date: string | null
  is_active: boolean
  manager_id: string | null
  invited_at: string | null
}

type UserForm = {
  full_name: string
  email: string
  role: string
  phone: string
  birth_date: string
  manager_id: string
}

const EMPTY_FORM: UserForm = {
  full_name: '',
  email: '',
  role: 'sales_person',
  phone: '',
  birth_date: '',
  manager_id: '',
}

const ROLES = [
  { value: 'co_admin', label: 'CO Admin' },
  { value: 'po_admin',      label: 'PO Admin' },
  { value: 'sales_person',  label: 'Sales Person' },
  { value: 'sales_manager', label: 'Sales Manager' },
  { value: 'sales_head',    label: 'Sales Head' },
  { value: 'executive',     label: 'Executive' },
]

async function fetchUsers(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .rpc('pilot_list_users')
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Data pengguna tidak tersedia')
  return data
}

async function updateUser(payload: {
  id: string
  full_name: string
  role: string
  phone: string | null
  birth_date: string | null
  manager_id: string | null
  is_active: boolean
}) {
  const { error } = await supabase
    .from('users')
    .update({
      full_name: payload.full_name,
      role: payload.role,
      phone: payload.phone,
      birth_date: payload.birth_date,
      manager_id: payload.manager_id,
      is_active: payload.is_active,
    })
    .eq('id', payload.id)
  if (error) throw error
}

class InvitationError extends Error {
  mayHaveSent: boolean
  constructor(message: string, mayHaveSent = false) { super(message); this.mayHaveSent = mayHaveSent }
}
const unknownInvite = 'The invitation outcome is unknown. Do not resend. Ask an administrator to check the account and email delivery.'
const reviewStorageKey = `invitation-review:${import.meta.env.VITE_SUPABASE_URL}`
function readInviteReviews(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(reviewStorageKey) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch { return {} }
}
async function inviteUser(payload: UserForm, accessToken: string) {
  let response: Response
  let data: { error?: string; success?: boolean; user_id?: string; may_have_sent?: boolean; code?: string }
  try {
    response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify(payload),
    })
    data = await response.json()
  } catch { throw new InvitationError(unknownInvite, true) }
  if (!data || typeof data !== 'object') throw new InvitationError(unknownInvite, true)
  if (!response.ok) {
    const knownRejections = ['UNAUTHORIZED', 'FORBIDDEN', 'METHOD_NOT_ALLOWED', 'INVITE_NOT_CONFIGURED', 'INVALID_ORIGIN', 'INVALID_PAYLOAD', 'LOOKUP_FAILED', 'PROFILE_EXISTS', 'INVALID_MANAGER', 'INVITE_UNAVAILABLE', 'INVITE_REJECTED']
    const uncertain = data.may_have_sent === true || !knownRejections.includes(data.code ?? '')
    throw new InvitationError(uncertain ? (data.may_have_sent ? data.error ?? unknownInvite : unknownInvite) : data.error ?? 'Failed to invite user', uncertain)
  }
  if (data.success !== true || typeof data.user_id !== 'string') throw new InvitationError(unknownInvite, true)
  return data
}

export default function UserManagement() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null)
  const [form, setForm] = useState<UserForm>(EMPTY_FORM)
  const [deactivateId, setDeactivateId] = useState<string | null>(null)
  const formGeneration = useRef(0)
  const inFlight = useRef(false)
  const [saving, setSaving] = useState(false)
  const savingGeneration = useRef(-1)
  const formReturnFocus = useRef<HTMLElement | null>(null)
  const deactivateReturnFocus = useRef<HTMLElement | null>(null)
  const directoryFocus = useRef<HTMLDivElement>(null)
  const feedbackFocus = useRef<HTMLDivElement>(null)
  const [feedback, setFeedback] = useState('')
  const [directoryError, setDirectoryError] = useState('')
  const [deactivateError, setDeactivateError] = useState('')
  const deactivationInFlight = useRef(false)
  const deactivateOwner = useRef<string | null>(null)
  const reactivationInFlight = useRef(new Set<string>())
  const [reactivatingIds, setReactivatingIds] = useState<Set<string>>(() => new Set())
  const formSaving = saving && savingGeneration.current === formGeneration.current
  useEffect(() => { if (feedback) feedbackFocus.current?.focus() }, [feedback])
  const [formError, setFormError] = useState('')
  const [inviteReviews, setInviteReviews] = useState<Record<string, string>>(readInviteReviews)
  const inviteReviewsRef = useRef(inviteReviews)
  const storeReview = (email: string, message: string | null) => {
    const next = { ...readInviteReviews(), ...inviteReviewsRef.current }
    if (message) next[email] = message
    else delete next[email]
    const serialized = JSON.stringify(next)
    sessionStorage.setItem(reviewStorageKey, serialized)
    if (sessionStorage.getItem(reviewStorageKey) !== serialized) throw new Error('Invitation tracking unavailable')
    inviteReviewsRef.current = next
    setInviteReviews(next)
  }
  const reviewRequired = !editingUser ? inviteReviews[form.email.trim().toLowerCase()] : undefined
  const finishSave = () => { inFlight.current = false; setSaving(false) }
  const closeForm = () => {
    formGeneration.current++
    setShowForm(false); setEditingUser(null); setForm(EMPTY_FORM); setFormError('')
  }
  const saveError = (error: Error, generation: number) => {
    if (generation === formGeneration.current) setFormError(error.message)
  }

  const dismissForm = () => {
    if (!editingUser || !inFlight.current || savingGeneration.current !== formGeneration.current) closeForm()
  }

  const { data: users, isPending, fetchStatus, isError: usersFailed, refetch } = useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
  })

  const managers = users?.filter(u =>
    (u.role === 'sales_manager' || u.role === 'sales_head' || u.role === 'executive') && u.is_active
  ) ?? []

  const updateMutation = useMutation({
    mutationFn: ({ payload }: { payload: Parameters<typeof updateUser>[0]; generation: number }) => updateUser(payload),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      if (variables.generation === formGeneration.current) { closeForm(); setFeedback('User updated.') }
    },
    onError: (error, variables) => saveError(error, variables.generation),
    onSettled: finishSave,
  })

  const inviteMutation = useMutation({
    mutationFn: async ({ payload }: { payload: UserForm; generation: number }) => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const email = payload.email.trim().toLowerCase()
      // Persist before the external action, so reload/unmount cannot erase an
      // in-flight invitation. If tracking cannot be stored, do not send.
      try { storeReview(email, unknownInvite) } catch {
        throw new Error('Unable to safely track the invitation. No invitation was sent. Enable browser session storage and try again.')
      }
      try {
        const result = await inviteUser(payload, session.access_token)
        try { storeReview(email, null) } catch { /* A stale hold is safer than an untracked resend. */ }
        return result
      } catch (error) {
        if (error instanceof InvitationError && !error.mayHaveSent) {
          try { storeReview(email, null) } catch { /* Preserve the hold if storage becomes unavailable. */ }
        } else {
          try { storeReview(email, error instanceof InvitationError ? error.message : unknownInvite) } catch { /* The pre-send unknown marker remains. */ }
        }
        throw error
      }
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      if (variables.generation === formGeneration.current) { closeForm(); setFeedback('Invitation request accepted. Delivery is not confirmed; contact an administrator if follow-up is needed.') }
    },
    onError: (error, variables) => {
      saveError(error, variables.generation)
    },
    onSettled: finishSave,
  })

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const user = users?.find(u => u.id === id)
      if (!user) return 'target-unavailable' as const
      await updateUser({ ...user, is_active: false })
      return 'applied' as const
    },
    onSuccess: (outcome, id) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      if (deactivateOwner.current !== id) return
      if (outcome === 'applied') {
        setDeactivateId(null); deactivateOwner.current = null; setFeedback('User deactivated.')
      } else {
        setDeactivateError('User unavailable. Reload the user list before trying again. No deactivation was confirmed.')
      }
    },
    onError: (error, id) => { if (deactivateOwner.current === id) setDeactivateError(error.message) },
    onSettled: () => { deactivationInFlight.current = false },
  })

  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const user = users?.find(u => u.id === id)
      if (!user) return
      await updateUser({ ...user, is_active: true })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: error => setDirectoryError(error.message),
    onSettled: (_result, _error, id) => {
      reactivationInFlight.current.delete(id)
      setReactivatingIds(new Set(reactivationInFlight.current))
    },
  })

  const openDeactivate = (id: string, opener: HTMLElement) => {
    if (deactivationInFlight.current) return
    deactivateReturnFocus.current = opener; deactivateOwner.current = id
    setDeactivateError(''); setFeedback(''); setDeactivateId(id)
  }
  const dismissDeactivate = () => {
    if (deactivationInFlight.current) return
    deactivateOwner.current = null; setDeactivateId(null); setDeactivateError('')
  }
  const handleDeactivate = () => {
    if (deactivationInFlight.current || !deactivateId) return
    deactivationInFlight.current = true; setDeactivateError('')
    deactivateMutation.mutate(deactivateId)
  }
  const handleReactivate = (id: string) => {
    if (reactivationInFlight.current.has(id)) return
    reactivationInFlight.current.add(id)
    setReactivatingIds(new Set(reactivationInFlight.current))
    setDirectoryError(''); setFeedback('')
    reactivateMutation.mutate(id)
  }

  const openCreate = (opener: HTMLElement) => {
    formReturnFocus.current = opener; setFeedback('')
    formGeneration.current++; setFormError('')
    setEditingUser(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const openEdit = (u: UserProfile, opener: HTMLElement) => {
    formReturnFocus.current = opener; setFeedback('')
    formGeneration.current++; setFormError('')
    setEditingUser(u)
    setForm({
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      phone: u.phone ?? '',
      birth_date: u.birth_date ?? '',
      manager_id: u.manager_id ?? '',
    })
    setShowForm(true)
  }

  const handleSave = () => {
    if (inFlight.current || reviewRequired) return
    if (!form.full_name.trim()) return setFormError('Full name is required.')
    if (!form.email.trim()) return setFormError('Email is required.')

    inFlight.current = true; savingGeneration.current = formGeneration.current; setSaving(true); setFormError('')
    if (editingUser) {
      updateMutation.mutate({ generation: formGeneration.current, payload: {
        id: editingUser.id,
        full_name: form.full_name,
        role: form.role,
        phone: form.phone || null,
        birth_date: form.birth_date || null,
        manager_id: form.manager_id || null,
        is_active: editingUser.is_active,
      } })
    } else {
      inviteMutation.mutate({ payload: { ...form }, generation: formGeneration.current })
    }
  }

  const filtered = users?.filter(u => {
    const matchSearch =
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'all' || u.role === roleFilter
    return matchSearch && matchRole
  })

  const deactivateTarget = users?.find(u => u.id === deactivateId)

  const needsManager = ['sales_person', 'sales_manager', 'sales_head'].includes(form.role)

  const hasUsers = users !== undefined
  const waitingForConnection = isPending && fetchStatus === 'paused'
  const countDescription = hasUsers ? `${users.filter(user => user.is_active).length} active users`
    : usersFailed ? 'User list unavailable' : waitingForConnection ? 'Waiting for connection' : 'Loading users...'

  return (
    <div className="min-h-screen bg-brand-canvas">
      <IHRNav />
      <MainContent className="px-4 md:px-8 py-6 max-w-6xl mx-auto space-y-4">
        <PageHeader title="User Management" description={countDescription}
          actions={<Button onClick={event => openCreate(event.currentTarget)}>+ Invite User</Button>} />
        <FilterBar label="Filter users">
          <Field id="user-search" label="Search users" className="w-full md:w-72">
            {control => <input {...control} type="text" placeholder="Search by name or email..." value={search} onChange={event => setSearch(event.target.value)} />}
          </Field>
          <Field id="user-role-filter" label="Filter by role">
            {control => <select {...control} value={roleFilter} onChange={event => setRoleFilter(event.target.value)}>
              <option value="all">All roles</option>
              {ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>}
          </Field>
        </FilterBar>
        {feedback && <div ref={feedbackFocus} tabIndex={-1}>
          <Notice tone="success" title={feedback} aria-label="User administration result" />
        </div>}
        {directoryError && <Notice tone="error" title={directoryError} />}
        {!hasUsers && isPending && <LoadingState title={waitingForConnection ? 'Waiting for connection' : 'Loading users...'} shape="list">
          {waitingForConnection && 'The user list will load when the connection returns.'}
        </LoadingState>}
        {usersFailed && <Notice tone="error" title="Unable to load users. Check the connection before creating or editing accounts."
          actions={<Button size="compact" variant="secondary" onClick={() => void refetch()}>Retry</Button>} />}
        <div ref={directoryFocus} tabIndex={-1} aria-label="User directory" className="min-w-0">
          {hasUsers && (filtered?.length === 0 ? <EmptyState title="No users found." /> : (
            <div role="region" aria-label="User directory" tabIndex={0} className="bg-white rounded-[14px] border border-brand-divider overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">User directory</caption>
                <thead><tr className="bg-brand-canvas border-b border-brand-divider">
                  <th scope="col" className="text-left px-5 py-3 font-medium text-brand-secondary">Name</th>
                  <th scope="col" className="text-left px-5 py-3 font-medium text-brand-secondary hidden md:table-cell">Email</th>
                  <th scope="col" className="text-left px-5 py-3 font-medium text-brand-secondary">Role</th>
                  <th scope="col" className="text-left px-5 py-3 font-medium text-brand-secondary hidden md:table-cell">Manager</th>
                  <th scope="col" className="text-left px-5 py-3 font-medium text-brand-secondary hidden md:table-cell">Status</th>
                  <th scope="col" className="text-right px-5 py-3 font-medium text-brand-secondary">Actions</th>
                </tr></thead>
                <tbody>{filtered?.map(user => {
                  const manager = users.find(candidate => candidate.id === user.manager_id)
                  return <tr key={user.id} className={`border-b border-brand-divider ${user.is_active ? 'hover:bg-brand-canvas' : 'bg-brand-canvas'}`}>
                    <td className="px-5 py-4"><div className="flex items-center gap-3">
                      <div aria-hidden="true" className="w-8 h-8 rounded-full bg-brand-tint text-brand-primary text-[13px] font-semibold flex items-center justify-center shrink-0">
                        {user.full_name.split(' ').map(name => name[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div><p className="font-medium text-brand-primary">{user.full_name}</p><p className="text-[13px] text-brand-secondary md:hidden">{user.email}</p></div>
                    </div></td>
                    <td className="px-5 py-4 text-brand-secondary hidden md:table-cell">{user.email}</td>
                    <td className="px-5 py-4"><StatusBadge tone="neutral">{ROLES.find(role => role.value === user.role)?.label ?? user.role}</StatusBadge></td>
                    <td className="px-5 py-4 text-brand-secondary hidden md:table-cell">{manager?.full_name ?? '—'}</td>
                    <td className="px-5 py-4 hidden md:table-cell"><StatusBadge tone={user.is_active ? 'success' : 'neutral'}>{user.is_active ? 'Active' : 'Inactive'}</StatusBadge></td>
                    <td className="px-5 py-4"><FormActions>
                      <Button size="compact" variant="quiet" onClick={event => openEdit(user, event.currentTarget)}>Edit</Button>
                      {user.is_active ? <Button size="compact" variant="danger-quiet" onClick={event => openDeactivate(user.id, event.currentTarget)}>Deactivate</Button>
                        : <Button size="compact" variant="quiet" pending={reactivatingIds.has(user.id)} onClick={() => handleReactivate(user.id)}>{reactivatingIds.has(user.id) ? 'Reactivating...' : 'Reactivate'}</Button>}
                    </FormActions></td>
                  </tr>
                })}</tbody>
              </table>
            </div>
          ))}
        </div>
      </MainContent>

      {showForm && <Dialog labelledBy="user-form-title" pending={!!editingUser && formSaving} onClose={dismissForm}
        returnFocus={formReturnFocus.current} fallbackFocus={() => directoryFocus.current}>
        <h2 id="user-form-title" className="ui-dialog__title">{editingUser ? 'Edit User' : 'Invite New User'}</h2>
        {!editingUser && <p className="ui-dialog__description">Request an invitation so the user can set their password. Email delivery is not confirmed here.</p>}
        <form noValidate onSubmit={event => { event.preventDefault(); handleSave() }} className="space-y-4 mt-4">
          <Field id="user-full-name" label="Full Name *">
            {control => <input {...control} type="text" disabled={formSaving} value={form.full_name} onChange={event => setForm(previous => ({ ...previous, full_name: event.target.value }))} placeholder="e.g. Budi Santoso" />}
          </Field>
          <Field id="user-email" label="Email *" hint={editingUser ? 'Email cannot be changed after invitation.' : undefined}>
            {control => <input {...control} type="email" disabled={!!editingUser || formSaving} value={form.email} onChange={event => setForm(previous => ({ ...previous, email: event.target.value }))} placeholder="budi@company.com" />}
          </Field>
          <Field id="user-role" label="Role *">
            {control => <select {...control} disabled={formSaving} value={form.role} onChange={event => setForm(previous => ({ ...previous, role: event.target.value, manager_id: '' }))}>
              {ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>}
          </Field>
          {needsManager && <Field id="user-manager" label="Assigned To (optional)">
            {control => <select {...control} disabled={formSaving} value={form.manager_id} onChange={event => setForm(previous => ({ ...previous, manager_id: event.target.value }))}>
              <option value="">No manager assigned</option>
              {managers.map(manager => <option key={manager.id} value={manager.id}>{manager.full_name}</option>)}
            </select>}
          </Field>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field id="user-phone" label="Phone (optional)">
              {control => <input {...control} type="text" disabled={formSaving} value={form.phone} onChange={event => setForm(previous => ({ ...previous, phone: event.target.value }))} placeholder="e.g. 0812-3456-7890" />}
            </Field>
            <Field id="user-birth-date" label="Birth Date (optional)">
              {control => <input {...control} type="date" disabled={formSaving} value={form.birth_date} onChange={event => setForm(previous => ({ ...previous, birth_date: event.target.value }))} />}
            </Field>
          </div>
          {!formSaving && (reviewRequired || formError) && <Notice tone="error" title={reviewRequired || formError} />}
          <FormActions>
            <Button variant="quiet" disabled={!!editingUser && formSaving} onClick={dismissForm}>Cancel</Button>
            <Button type="submit" pending={formSaving} disabled={saving || !!reviewRequired}>{formSaving ? 'Saving...' : editingUser ? 'Save Changes' : 'Send Invite'}</Button>
          </FormActions>
        </form>
      </Dialog>}

      {deactivateId && <Dialog labelledBy="deactivate-user-title" pending={deactivateMutation.isPending} onClose={dismissDeactivate}
        returnFocus={deactivateReturnFocus.current} fallbackFocus={() => directoryFocus.current}>
        <h2 id="deactivate-user-title" className="ui-dialog__title">Deactivate user?</h2>
        <p className="ui-dialog__description"><strong>{deactivateTarget?.full_name}</strong> will no longer be able to log in. You can reactivate them at any time.</p>
        {deactivateError && <Notice tone="error" title={deactivateError} className="mt-4"
          actions={<Button size="compact" variant="secondary" onClick={() => void refetch()}>Reload user list</Button>} />}
        <FormActions className="mt-6">
          <Button variant="quiet" disabled={deactivateMutation.isPending} onClick={dismissDeactivate}>Cancel</Button>
          <Button variant="danger" pending={deactivateMutation.isPending} onClick={handleDeactivate}>{deactivateMutation.isPending ? 'Deactivating...' : 'Deactivate'}</Button>
        </FormActions>
      </Dialog>}
    </div>
  )
}
