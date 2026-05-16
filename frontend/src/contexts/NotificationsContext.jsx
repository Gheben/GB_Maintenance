import { createContext, useContext, useState, useCallback } from 'react'
import { notificationsApi } from '../api'

const NotificationsContext = createContext(null)

export function NotificationsProvider({ children }) {
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await notificationsApi.list({ unread: true, page: 1, limit: 25 })
      setNotifications(res.data.data)
      setUnreadCount(res.data.unread_count)
    } catch { /* ignore */ }
  }, [])

  const markRead = async (ids) => {
    await notificationsApi.markRead(ids)
    setNotifications(prev => prev.filter(n => !ids.includes(n.id)))
    setUnreadCount(prev => Math.max(0, prev - ids.length))
  }

  const markAllRead = async () => {
    await notificationsApi.markAllRead()
    setNotifications([])
    setUnreadCount(0)
  }

  const clearAll = async () => {
    await notificationsApi.deleteAll()
    setNotifications([])
    setUnreadCount(0)
  }

  const addNotification = (notif) => {
    setNotifications(prev => [notif, ...prev].slice(0, 25))
    if (!notif.is_read) setUnreadCount(c => c + 1)
  }

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, fetchNotifications, markRead, markAllRead, clearAll, addNotification }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export const useNotifications = () => useContext(NotificationsContext)
