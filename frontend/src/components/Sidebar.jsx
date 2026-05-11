import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Server, Package, CalendarClock, AlertTriangle,
  Calendar, Globe, Bell, BarChart2, Users, Settings, Key, ScrollText,
  ClipboardList, Ban, LogOut
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', perm: 'dashboard' },
  { to: '/assets', icon: Package, label: 'Asset', perm: 'assets' },
  { to: '/services', icon: Server, label: 'Servizi', perm: 'services' },
  { to: '/maintenance', icon: CalendarClock, label: 'Manutenzioni', perm: 'maintenance' },
  { to: '/incidents', icon: AlertTriangle, label: 'Incidenti', perm: 'incidents' },
  { to: '/calendar', icon: Calendar, label: 'Calendario', perm: 'calendar' },
  { to: '/status', icon: Globe, label: 'Status Page', perm: 'status_page' },
  { to: '/notifications', icon: Bell, label: 'Notifiche', perm: 'notifications' },
  { to: '/reports', icon: BarChart2, label: 'Report', perm: 'reports' },
  null, // divider
  { to: '/users', icon: Users, label: 'Utenti & Gruppi', perm: 'users' },
  { to: '/templates', icon: ClipboardList, label: 'Template', perm: 'maintenance' },
  { to: '/blackout', icon: Ban, label: 'Blackout', perm: 'maintenance' },
  { to: '/apikeys', icon: Key, label: 'API Keys', perm: 'apikeys' },
  { to: '/audit', icon: ScrollText, label: 'Audit Log', perm: 'audit' },
  { to: '/settings', icon: Settings, label: 'Impostazioni', perm: 'settings' },
]

export function Sidebar() {
  const { user, logout, hasPermission } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => { await logout(); navigate('/login') }

  return (
    <aside className="flex flex-col w-64 bg-gray-900 text-gray-100 h-screen overflow-y-auto shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-700">
        <img src="/logo.svg" alt="GB Maintenance" className="w-9 h-9 rounded-lg" />
        <span className="font-bold text-lg leading-tight">GB<br /><span className="text-xs font-normal text-gray-400 tracking-wide">Maintenance</span></span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map((item, i) => {
          if (!item) return <div key={i} className="my-2 border-t border-gray-700" />
          if (!hasPermission(item.perm)) return null
          const Icon = item.icon
          return (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-brand-700 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}>
              <Icon size={17} />
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="px-4 py-3 border-t border-gray-700">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
            style={{ backgroundColor: user?.avatar_color || '#3b82f6' }}>
            {user?.display_name?.[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.display_name}</p>
            <p className="text-xs text-gray-400 truncate">{user?.role}</p>
          </div>
          <button onClick={handleLogout} title="Logout" className="p-1 rounded hover:bg-gray-700">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
