import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Server, Package, CalendarClock, AlertTriangle,
  Calendar, Globe, Bell, BarChart2, Users, Settings, ScrollText,
  Ban, LogOut, BookOpen, ChevronLeft, ChevronRight, X, FileBadge2
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { settingsApi } from '../api'

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', perm: 'dashboard' },
  { to: '/assets', icon: Package, label: 'Assets', perm: 'assets' },
  { to: '/services', icon: Server, label: 'Services', perm: 'services' },
  { to: '/maintenance', icon: CalendarClock, label: 'Maintenance', perm: 'maintenance' },
  { to: '/incidents', icon: AlertTriangle, label: 'Incidents', perm: 'incidents' },
  { to: '/calendar', icon: Calendar, label: 'Calendar', perm: 'calendar' },
  { to: '/notifications', icon: Bell, label: 'Notifications', perm: 'notifications' },
  { to: '/reports', icon: BarChart2, label: 'Reports', perm: 'reports' },
  { to: '/licenses', icon: FileBadge2, label: 'Licenses', perm: 'maintenance' },
  { divider: true },
  { to: '/users', icon: Users, label: 'Users & Groups', perm: 'users' },
  { to: '/blackout', icon: Ban, label: 'Blackout', perm: 'maintenance' },
  { to: '/audit', icon: ScrollText, label: 'Audit Log', perm: 'audit' },
  { to: '/settings', icon: Settings, label: 'Settings', perm: 'settings' },
  { to: '/status', icon: Globe, label: 'Status Page', perm: 'status_page' },
  { divider: true },
  { href: '/docs', icon: BookOpen, label: 'API Docs', perm: 'apikeys' },
]

export function Sidebar({ open, onClose, collapsed, onToggleCollapse }) {
  const { user, logout, hasPermission } = useAuth()
  const navigate = useNavigate()
  const [branding, setBranding] = useState({ app_name: 'GB Maintenance', app_brand_image_url: '' })

  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = e => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    settingsApi.publicBranding()
      .then(r => {
        const b = r.data || {}
        setBranding({
          app_name: b.app_name || 'GB Maintenance',
          app_brand_image_url: b.app_brand_image_url || '',
        })
      })
      .catch(() => {})

    const onBrandingUpdate = (ev) => {
      const b = ev?.detail || {}
      setBranding({
        app_name: b.app_name || 'GB Maintenance',
        app_brand_image_url: b.app_brand_image_url || '',
      })
    }

    window.addEventListener('app-branding-updated', onBrandingUpdate)
    return () => window.removeEventListener('app-branding-updated', onBrandingUpdate)
  }, [])

  // Collapse only applies on desktop; mobile drawer always shows full width + labels
  const cl = collapsed && isDesktop
  const appName = branding.app_name || 'GB Maintenance'
  const brandImage = String(branding.app_brand_image_url || '').trim()

  const handleLogout = async () => { await logout(); navigate('/login') }

  const isVisible = item => {
    if (item.divider) return false
    if (item.perm && !hasPermission(item.perm)) return false
    return true
  }

  const itemBase = cl
    ? 'flex justify-center items-center p-2 rounded-lg text-sm transition-colors'
    : 'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors'

  return (
    <>
      {open && (
        <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={onClose} />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-30 bg-gray-900 text-white flex flex-col
        transform transition-all duration-200 ease-in-out
        md:static md:translate-x-0 md:flex-shrink-0
        ${cl ? 'w-16' : 'w-64'}
        ${open ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Header / Logo */}
        <div style={{ paddingTop: 'env(safe-area-inset-top)' }}
          className={`border-b border-gray-700 flex items-center ${cl ? 'px-1 py-4 justify-between' : 'px-5 py-4 gap-3'}`}>
          {brandImage ? (
            <img src={brandImage} alt={appName} className="w-8 h-8 rounded-lg flex-shrink-0 object-contain bg-gray-800" />
          ) : (
            <img src="/logo.svg" alt={appName} className="w-8 h-8 rounded-lg flex-shrink-0" />
          )}
          {!cl && (
            <div className="min-w-0 flex-1 flex flex-col">
              <span className="font-bold text-sm tracking-wide leading-tight block truncate">{appName}</span>
              <span className="text-xs text-gray-400 leading-tight truncate">Maintenance Tool</span>
            </div>
          )}
          {/* Mobile: close button */}
          {!cl && (
            <button onClick={onClose} className="md:hidden text-gray-400 hover:text-white p-1" aria-label="Close menu">
              <X size={18} />
            </button>
          )}
          {/* Desktop: collapse toggle */}
          <button
            onClick={onToggleCollapse}
            className="hidden md:block text-gray-400 hover:text-white p-1"
            aria-label={cl ? 'Expand menu' : 'Collapse menu'}
          >
            {cl ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* Nav */}
        <nav className={`flex-1 ${cl ? 'px-1' : 'px-3'} py-3 space-y-0.5 overflow-y-auto scrollbar-thin`}>
          {NAV.map((item, i) => {
            if (item.divider) {
              const prevDivIdx = NAV.slice(0, i).reduce((acc, x, j) => x.divider ? j : acc, -1)
              const hasBefore = NAV.slice(prevDivIdx + 1, i).some(isVisible)
              const hasAfter  = NAV.slice(i + 1).some(isVisible)
              return (hasBefore && hasAfter)
                ? <div key={i} className="my-2 border-t border-gray-700" />
                : null
            }
            if (!hasPermission(item.perm)) return null
            const Icon = item.icon
            if (item.href) {
              return (
                <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer"
                  onClick={onClose}
                  title={cl ? item.label : undefined}
                  className={`${itemBase} text-gray-300 hover:bg-gray-800 hover:text-white`}>
                  <Icon size={17} className="flex-shrink-0" />
                  {!cl && <span className="leading-tight">{item.label}</span>}
                </a>
              )
            }
            return (
              <NavLink key={item.to} to={item.to} end={item.to === '/'}
                onClick={onClose}
                title={cl ? item.label : undefined}
                className={({ isActive }) =>
                  `${itemBase} ${isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`}>
                <Icon size={17} className="flex-shrink-0" />
                {!cl && <span className="leading-tight">{item.label}</span>}
              </NavLink>
            )
          })}
        </nav>

        {/* User footer */}
        <div className={`${cl ? 'px-1' : 'px-3'} py-3 border-t border-gray-700 space-y-1`}>
          {user && !cl && (
            <div className="px-3 py-1.5 min-w-0">
              <p className="text-sm font-semibold text-gray-200 truncate leading-tight"
                title={user.display_name || user.username}>
                {user.display_name || user.username}
              </p>
              <p className="text-[11px] text-gray-500 truncate leading-tight mt-0.5">
                {user.username} &middot; {user.role}
              </p>
            </div>
          )}
          <button
            onClick={handleLogout}
            title={cl ? 'Sign out' : undefined}
            className={`w-full flex items-center py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors ${cl ? 'justify-center p-2' : 'gap-3 px-3'}`}
          >
            <LogOut size={17} className="flex-shrink-0" />
            {!cl && 'Sign out'}
          </button>
          {!cl && (
            <div className="px-3 py-1">
              <p className="text-[10px] text-gray-600 leading-snug truncate">
                v1.0 &mdash; Powered by <span className="text-gray-500 font-medium">Guido Ballarini</span> &copy; 2026
              </p>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
