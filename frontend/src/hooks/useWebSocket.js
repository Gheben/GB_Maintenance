import { useEffect, useRef } from 'react'
import { useNotifications } from '../contexts/NotificationsContext'

export function useWebSocket(onMessage) {
  const wsRef = useRef(null)
  const { addNotification } = useNotifications()

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) return

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${window.location.host}/ws?token=${token}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type === 'notification') {
          addNotification(msg.payload)
        }
        onMessage?.(msg)
      } catch { /* ignore */ }
    }

    ws.onerror = () => {}
    ws.onclose = () => {}

    return () => ws.close()
  }, [])

  return wsRef
}
