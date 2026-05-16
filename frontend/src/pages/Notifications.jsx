import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { notificationsApi } from '../api'
import { useNotifications } from '../contexts/NotificationsContext'
import { Pagination } from '../components/Pagination'
import { format } from 'date-fns'
import { toast } from '../components/Toast'

export default function Notifications() {
  const { unreadCount, markRead, markAllRead, fetchNotifications, clearAll } = useNotifications()
  const [inapp, setInapp] = useState([])
  const [inappTotal, setInappTotal] = useState(0)
  const [inappPage, setInappPage] = useState(1)
  const [inappLimit, setInappLimit] = useState(25)
  const [log, setLog] = useState([])
  const [logTotal, setLogTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [logLimit, setLogLimit] = useState(25)
  const [tab, setTab] = useState('inapp')

  useEffect(() => {
    if (tab === 'inapp') {
      notificationsApi.list({ page: inappPage, limit: inappLimit }).then(r => {
        setInapp(r.data.data || [])
        setInappTotal(r.data.total || 0)
      }).catch(() => {})
    }
  }, [tab, inappPage, inappLimit])

  useEffect(() => { fetchNotifications() }, [])
  useEffect(() => {
    if (tab === 'log') {
      notificationsApi.log({ page: logPage, limit: logLimit }).then(r => { setLog(r.data.data); setLogTotal(r.data.total) })
    }
  }, [tab, logPage, logLimit])

  const refreshInApp = async () => {
    const r = await notificationsApi.list({ page: inappPage, limit: inappLimit })
    setInapp(r.data.data || [])
    setInappTotal(r.data.total || 0)
  }

  const handleMarkAllRead = async () => {
    try {
      await markAllRead()
      await Promise.all([fetchNotifications(), refreshInApp()])
    } catch {
      toast.error('Failed to mark notifications as read')
    }
  }

  const handleClearAll = async () => {
    try {
      await clearAll()
      await Promise.all([fetchNotifications(), refreshInApp()])
      toast.success('All notifications deleted')
    } catch {
      toast.error('Failed to delete notifications')
    }
  }

  const handleMarkOneRead = async (id) => {
    try {
      await markRead([id])
      await Promise.all([fetchNotifications(), refreshInApp()])
    } catch {
      toast.error('Failed to update notification')
    }
  }

  return (
    <Layout title="Notifications">
      <div className="space-y-4">
        <div className="py-2 -mx-4 sm:mx-0 px-4 sm:px-0 border-b border-gray-200 dark:border-gray-700">
          <nav className="flex flex-wrap gap-1.5">
            {[['inapp','In-app'],['log','Notification log']].map(([k,l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-full transition-colors ${
                  tab === k ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-200'
                }`}>{l}</button>
            ))}
          </nav>
        </div>

        {tab === 'inapp' && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <span className="text-sm font-medium">{unreadCount} unread</span>
              <div className="flex items-center gap-3">
                {unreadCount > 0 && <button className="action-text-btn" onClick={handleMarkAllRead}>Mark all read</button>}
                {inappTotal > 0 && <button className="action-text-btn text-red-600 hover:text-red-700" onClick={handleClearAll}>Delete all</button>}
              </div>
            </div>
            <div className="p-2 space-y-2">
              {inapp.length === 0 && <p className="text-center text-gray-500 py-8 text-sm">No notifications</p>}
              {inapp.map(n => {
                const message = String(n.message || '').trim()
                const showMessage = message && message !== '-'
                return (
                  <div key={n.id} onClick={() => !n.is_read && handleMarkOneRead(n.id)}
                    className={`px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${!n.is_read ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-100 dark:border-blue-900/40' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'} hover:bg-gray-50 dark:hover:bg-gray-700/50`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-5">{n.title}</p>
                      <p className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5">{format(new Date(n.created_at), 'MMM dd HH:mm')}</p>
                    </div>
                    {showMessage && <p className="text-xs text-gray-500 mt-1">{message}</p>}
                  </div>
                )
              })}
            </div>
            <div className="p-4 border-t border-gray-100 dark:border-gray-700">
              <Pagination
                page={inappPage}
                limit={inappLimit}
                total={inappTotal}
                onChange={setInappPage}
                onLimitChange={(v) => setInappLimit(Math.min(25, v))}
                pageSizes={[10, 25]}
              />
            </div>
          </div>
        )}

        {tab === 'log' && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>{['Event','Channel','Recipient','Status','Date'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {log.map(l => (
                  <tr key={l.id}>
                    <td className="px-4 py-2 text-xs">{l.event_type}</td>
                    <td className="px-4 py-2 text-xs">{l.channel}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{l.recipient}</td>
                    <td className="px-4 py-2 text-xs">{l.status === 'sent' ? '✅' : '❌'} {l.status}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{format(new Date(l.created_at), 'MM/dd HH:mm')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-4"><Pagination page={logPage} limit={logLimit} total={logTotal} onChange={setLogPage} onLimitChange={setLogLimit} /></div>
          </div>
        )}
      </div>
    </Layout>
  )
}
