import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { notificationsApi } from '../api'
import { useNotifications } from '../contexts/NotificationsContext'
import { Pagination } from '../components/Pagination'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'

export default function Notifications() {
  const { notifications, unreadCount, markRead, markAllRead, fetchNotifications } = useNotifications()
  const [log, setLog] = useState([])
  const [logTotal, setLogTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [tab, setTab] = useState('inapp')

  useEffect(() => { fetchNotifications() }, [])
  useEffect(() => {
    if (tab === 'log') {
      notificationsApi.log({ page: logPage, limit: 30 }).then(r => { setLog(r.data.data); setLogTotal(r.data.total) })
    }
  }, [tab, logPage])

  return (
    <Layout title="Notifiche">
      <div className="max-w-3xl space-y-4">
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {[['inapp','In-app'],['log','Log notifiche']].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm font-medium ${tab === k ? 'border-b-2 border-brand-600 text-brand-600' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
          ))}
        </div>

        {tab === 'inapp' && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <span className="text-sm font-medium">{unreadCount} non lette</span>
              {unreadCount > 0 && <button className="text-xs text-brand-600 hover:underline" onClick={markAllRead}>Segna tutte lette</button>}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {notifications.length === 0 && <p className="text-center text-gray-500 py-8 text-sm">Nessuna notifica</p>}
              {notifications.map(n => (
                <div key={n.id} onClick={() => !n.is_read && markRead([n.id])}
                  className={`px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 ${!n.is_read ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}>
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{n.message}</p>
                  <p className="text-[11px] text-gray-400 mt-1">{format(new Date(n.created_at), 'dd MMM HH:mm', { locale: it })}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'log' && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>{['Evento','Canale','Destinatario','Stato','Data'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {log.map(l => (
                  <tr key={l.id}>
                    <td className="px-4 py-2 text-xs">{l.event_type}</td>
                    <td className="px-4 py-2 text-xs">{l.channel}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{l.recipient}</td>
                    <td className="px-4 py-2 text-xs">{l.status === 'sent' ? '✅' : '❌'} {l.status}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{format(new Date(l.created_at), 'dd/MM HH:mm', { locale: it })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-4"><Pagination page={logPage} limit={30} total={logTotal} onChange={setLogPage} /></div>
          </div>
        )}
      </div>
    </Layout>
  )
}
