import { useState } from 'react'
import type { LeaveContext } from '../../../lib/leave/contracts'
/** Capability-only shell. Later owning tasks add their private panels and actions. */
export default function LeaveTabs({ context }: { context: LeaveContext }) {
  const [selected, setSelected] = useState(''), caps = context.capabilities
  const tabs = [
    ...(caps.request ? [{ id: 'mine', label: 'Cuti Saya' }] : []),
    ...(caps.approve ? [{ id: 'approvals', label: 'Persetujuan' }] : []),
    ...(caps.configure || caps.adjust || caps.readPrivate || caps.manageAccess ? [{ id: 'settings', label: 'Pengaturan' }] : []),
  ]
  if (!tabs.length) return <p className="text-sm text-gray-600">Belum ada akses cuti yang diberikan. Hubungi administrator HR.</p>
  const active = tabs.some(tab => tab.id === selected) ? selected : tabs[0].id
  return <section>
    <div role="tablist" aria-label="Manajemen cuti" className="flex flex-wrap gap-2 border-b border-gray-200">
      {tabs.map(tab => <button key={tab.id} id={`leave-tab-${tab.id}`} type="button" role="tab" aria-selected={tab.id === active}
        aria-controls={`leave-panel-${tab.id}`} onClick={() => setSelected(tab.id)}
        className={`px-4 py-3 text-sm font-medium border-b-2 ${tab.id === active ? 'border-orange-600 text-orange-700' : 'border-transparent text-gray-600'}`}>{tab.label}</button>)}
    </div>
    <div id={`leave-panel-${active}`} role="tabpanel" aria-labelledby={`leave-tab-${active}`} className="py-4 text-sm text-gray-600">Layanan ini sedang disiapkan. Tidak ada tindakan cuti yang tersedia saat ini.</div>
  </section>
}
