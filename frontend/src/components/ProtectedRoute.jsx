import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { toast } from './Toast'

export function ProtectedRoute({ children, permission, roles }) {
  const { user, loading, hasPermission } = useAuth()
  const location = useLocation()

  const permissionDenied = !!user && !!permission && !hasPermission(permission)
  const roleDenied = !!user && Array.isArray(roles) && roles.length > 0 && !roles.includes(user.role)

  // Explain why the user landed on the dashboard instead of silently bouncing them —
  // this matters most when arriving from a deep link (e.g. a push notification) that
  // points to a page their role/permissions don't allow them to view.
  useEffect(() => {
    if (permissionDenied || roleDenied) {
      toast.error("You don't have permission to view that page.")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  if (loading) return <div className="flex h-screen items-center justify-center"><div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" /></div>
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  if (permissionDenied || roleDenied) return <Navigate to="/" replace />
  return children
}
