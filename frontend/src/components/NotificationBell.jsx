import { useState, useRef, useEffect } from 'react'
import { Bell } from 'lucide-react'
import { useNotifications } from '../contexts/NotificationsContext'
import { formatDistanceToNow } from 'date-fns'
import { it } from 'date-fns/locale'

export function NotificationBell() {
  const { notifications, unreadCount, fetchNotifications, markAllRead, markRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => { fetchNotifications() }, [])

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 card shadow-xl z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <span className="font-medium text-sm">Notifiche</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs text-brand-600 hover:underline">Segna tutte lette</button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-700">
            {notifications.length === 0 ? (
              <p className="text-center text-gray-500 text-sm py-8">Nessuna notifica</p>
            ) : notifications.map(n => (
              <div key={n.id}
                onClick={() => !n.is_read && markRead([n.id])}
                className={`px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 ${!n.is_read ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}>
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                <p className="text-[11px] text-gray-400 mt-1">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: it })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
