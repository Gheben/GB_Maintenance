import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function ProtectedRoute({ children, permission, roles }) {
  const { user, loading, hasPermission } = useAuth()
  const location = useLocation()

  if (loading) return <div className="flex h-screen items-center justify-center"><div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" /></div>
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  if (permission && !hasPermission(permission)) return <Navigate to="/" replace />
  if (Array.isArray(roles) && roles.length > 0 && !roles.includes(user.role)) return <Navigate to="/" replace />
  return children
}
