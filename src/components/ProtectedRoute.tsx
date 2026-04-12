import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

type Props = {
  children: React.ReactNode
  allowedRoles?: string[]
}

export default function ProtectedRoute({ children, allowedRoles }: Props) {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    // Redirect to their home based on role
    const roleHome: Record<string, string> = {
      po_admin:      '/athel/po',
      sales_person:  '/girard/schedule',
      sales_manager: '/girard/schedule',
      sales_head:    '/girard/schedule',
      executive:     '/landing',
    }
    return <Navigate to={roleHome[profile.role] ?? '/login'} replace />
  }

  return <>{children}</>
}