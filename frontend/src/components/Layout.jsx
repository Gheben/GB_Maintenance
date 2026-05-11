import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useWebSocket } from '../hooks/useWebSocket'
import { useNotifications } from '../contexts/NotificationsContext'
import { useEffect } from 'react'

export function Layout({ title, children }) {
  const { fetchNotifications } = useNotifications()

  useWebSocket((msg) => {
    if (['maintenance_created','incident_created','notification'].includes(msg.type)) {
      fetchNotifications()
    }
  })

  useEffect(() => { fetchNotifications() }, [])

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header title={title} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
