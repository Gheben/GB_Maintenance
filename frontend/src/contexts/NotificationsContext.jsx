import { createContext, useContext, useState, useCallback } from 'react'
import { notificationsApi } from '../api'

const NotificationsContext = createContext(null)

export function NotificationsProvider({ children }) {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await notificationsApi.list({ limit: 20 })
      setNotifications(res.data.data)
      setUnreadCount(res.data.unread_count)
    } catch { /* ignore */ }
  }, [])

  const markRead = async (ids) => {
    await notificationsApi.markRead(ids)
    setNotifications(prev => prev.map(n => ids.includes(n.id) ? { ...n, is_read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - ids.length))
  }

  const markAllRead = async () => {
    await notificationsApi.markAllRead()
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
  }

  const addNotification = (notif) => {
    setNotifications(prev => [notif, ...prev].slice(0, 20))
    if (!notif.is_read) setUnreadCount(c => c + 1)
  }

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, fetchNotifications, markRead, markAllRead, addNotification }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export const useNotifications = () => useContext(NotificationsContext)
