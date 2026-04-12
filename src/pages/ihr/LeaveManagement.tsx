import IHRNav from '../../components/IHRNav'

export default function LeaveManagement() {
  return (
    <div className="min-h-screen bg-gray-50">
      <IHRNav />
      <div className="flex flex-col items-center justify-center py-32 px-4">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
          style={{ backgroundColor: '#fdf0eb' }}>
          <span className="text-2xl">📅</span>
        </div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Manajemen Cuti</h2>
        <p className="text-sm text-gray-400 text-center max-w-xs">
          Fitur manajemen cuti akan segera hadir. Anda akan dapat mengelola permohonan dan saldo cuti karyawan di sini.
        </p>
      </div>
    </div>
  )
}