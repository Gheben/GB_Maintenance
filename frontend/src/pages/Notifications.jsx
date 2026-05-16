import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { notificationsApi, maintenanceApi, incidentsApi, blackoutApi } from '../api'
import { useNotifications } from '../contexts/NotificationsContext'
import { Pagination } from '../components/Pagination'
import { format } from 'date-fns'
import { toast } from '../components/Toast'
import { Modal } from '../components/Modal'

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
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailData, setDetailData] = useState(null)
  const [detailType, setDetailType] = useState('')

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
    const ok = window.confirm('Delete all notifications? This action cannot be undone.')
    if (!ok) return
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

  const resolveReferenceType = (rawType) => {
    const t = String(rawType || '').toLowerCase()
    if (t === 'maintenance') return 'maintenance'
    if (t === 'incident') return 'incident'
    if (t === 'blackout' || t === 'blackout_period') return 'blackout'
    return ''
  }

  const openReferenceDetail = async (notification) => {
    const refType = resolveReferenceType(notification?.reference_type)
    const refId = notification?.reference_id
    if (!refType || !refId) {
      toast.error('No linked detail available for this notification')
      return
    }

    setDetailOpen(true)
    setDetailLoading(true)
    setDetailError('')
    setDetailData(null)
    setDetailType(refType)

    try {
      if (refType === 'maintenance') {
        const r = await maintenanceApi.get(refId)
        setDetailData(r.data || null)
      } else if (refType === 'incident') {
        const r = await incidentsApi.get(refId)
        setDetailData(r.data || null)
      } else if (refType === 'blackout') {
        const r = await blackoutApi.get(refId)
        setDetailData(r.data || null)
      }
    } catch (err) {
      setDetailError(err.response?.data?.error || 'Unable to load linked details')
    } finally {
      setDetailLoading(false)
    }
  }

  const detailTitle = detailType === 'maintenance'
    ? 'Maintenance detail'
    : detailType === 'incident'
      ? 'Incident detail'
      : detailType === 'blackout'
        ? 'Blackout detail'
        : 'Notification detail'

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
                  <div key={n.id}
                    onClick={() => !n.is_read && handleMarkOneRead(n.id)}
                    onDoubleClick={() => openReferenceDetail(n)}
                    className={`px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${!n.is_read ? 'bg-blue-50 dark:bg-blue-950/30 border-blue-100 dark:border-blue-900/40' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'} hover:bg-gray-50 dark:hover:bg-gray-700/50`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-5">{n.title}</p>
                      <p className="text-[11px] text-gray-400 whitespace-nowrap pt-0.5">{format(new Date(n.created_at), 'MMM dd HH:mm')}</p>
                    </div>
                    {showMessage && <p className="text-xs text-gray-500 mt-1">{message}</p>}
                    {(n.reference_type && n.reference_id) && (
                      <p className="text-[11px] text-brand-600 mt-1">Double click to open related details</p>
                    )}
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

      {detailOpen && (
        <Modal title={detailTitle} onClose={() => setDetailOpen(false)} size="lg">
          {detailLoading && <p className="text-sm text-gray-500">Loading details...</p>}
          {!detailLoading && detailError && <p className="text-sm text-red-600">{detailError}</p>}
          {!detailLoading && !detailError && detailData && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {'title' in detailData && <div><span className="text-gray-500">Title:</span> <span className="font-medium">{detailData.title || '-'}</span></div>}
                {'name' in detailData && <div><span className="text-gray-500">Name:</span> <span className="font-medium">{detailData.name || '-'}</span></div>}
                {'status' in detailData && <div><span className="text-gray-500">Status:</span> <span className="font-medium">{detailData.status || '-'}</span></div>}
                {'type' in detailData && <div><span className="text-gray-500">Type:</span> <span className="font-medium">{detailData.type || '-'}</span></div>}
                {'impact_level' in detailData && <div><span className="text-gray-500">Impact:</span> <span className="font-medium">{detailData.impact_level || '-'}</span></div>}
                {'severity' in detailData && <div><span className="text-gray-500">Severity:</span> <span className="font-medium">{detailData.severity || '-'}</span></div>}
                {'scheduled_start' in detailData && <div><span className="text-gray-500">Start:</span> <span className="font-medium">{detailData.scheduled_start ? format(new Date(detailData.scheduled_start), 'MMM dd yyyy HH:mm') : '-'}</span></div>}
                {'scheduled_end' in detailData && <div><span className="text-gray-500">End:</span> <span className="font-medium">{detailData.scheduled_end ? format(new Date(detailData.scheduled_end), 'MMM dd yyyy HH:mm') : '-'}</span></div>}
              </div>

              {'description' in detailData && (
                <div>
                  <p className="text-gray-500 mb-1">Description</p>
                  <p className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 bg-gray-50 dark:bg-gray-800/40">{detailData.description || '-'}</p>
                </div>
              )}

              {'notes' in detailData && detailData.notes && (
                <div>
                  <p className="text-gray-500 mb-1">Notes</p>
                  <p className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 bg-gray-50 dark:bg-gray-800/40">{detailData.notes}</p>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </Layout>
  )
}
