import SessionLoading from './SessionLoading'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { roleHome } from './navigationModules'

type Props = {
  children: React.ReactNode
  allowedRoles?: string[]
}

export default function ProtectedRoute({ children, allowedRoles }: Props) {
  const { user, profile, loading } = useAuth()

  if (loading) return <SessionLoading />

  if (!user || !profile || profile.id !== user.id || !profile.is_active) return <Navigate to="/login" replace />

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to={roleHome(profile.role)} replace />
  }

  return <>{children}</>
}