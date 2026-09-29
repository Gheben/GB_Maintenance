import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useWebSocket } from '../hooks/useWebSocket'
import { useNotifications } from '../contexts/NotificationsContext'
import { useEffect } from 'react'

export function Layout({ title, children }) {
  const { fetchNotifications } = useNotifications()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebar_collapsed') === 'true'
  )

  function toggleCollapse() {
    setSidebarCollapsed(v => {
      localStorage.setItem('sidebar_collapsed', String(!v))
      return !v
    })
  }

  useWebSocket((msg) => {
    if (['maintenance_created','incident_created','notification'].includes(msg.type)) {
      fetchNotifications()
    }
  })

  useEffect(() => { fetchNotifications() }, [])

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleCollapse}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header title={title} onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto scrollbar-thin p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
