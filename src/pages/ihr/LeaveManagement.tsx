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
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Leave Management</h2>
        <p className="text-sm text-gray-400 text-center max-w-xs">
          Leave management is coming soon. You'll be able to manage employee leave requests and balances here.
        </p>
      </div>
    </div>
  )
}