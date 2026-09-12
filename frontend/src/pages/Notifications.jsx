import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { notificationsApi, maintenanceApi, incidentsApi, blackoutApi, licensesApi } from '../api'
import { useNotifications } from '../contexts/NotificationsContext'
import { Pagination } from '../components/Pagination'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { format } from 'date-fns'
import { toast } from '../components/Toast'
import { Modal } from '../components/Modal'
import { Cog, Server, ShieldCheck } from 'lucide-react'

const TYPE_BADGE = {
  planned: 'bg-blue-100 text-blue-800 border-blue-200',
  emergency: 'bg-red-100 text-red-800 border-red-200',
  upgrade: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  security_patch: 'bg-amber-100 text-amber-800 border-amber-200',
  infrastructure: 'bg-slate-100 text-slate-800 border-slate-200',
  other: 'bg-gray-100 text-gray-700 border-gray-200',
}

const SEVERITY_BADGE = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-green-100 text-green-800 border-green-200',
}

const LICENSE_APPROVAL_STATUS_BADGE = {
  approved: 'bg-green-100 text-green-800 border-green-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
  pending: 'bg-amber-100 text-amber-800 border-amber-200',
}

function PrettyBadge({ value, classes }) {
  if (!value) return <span className="text-gray-500">-</span>
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${classes || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
      {String(value).replace(/_/g, ' ')}
    </span>
  )
}

function formatLicenseStatusLabel(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'approved') return 'Approved'
  if (normalized === 'rejected') return 'Rejected'
  if (normalized === 'pending') return 'Pending'
  return normalized ? normalized.replace(/_/g, ' ') : '-'
}

function getLicenseStatusBadgeClasses(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return LICENSE_APPROVAL_STATUS_BADGE[normalized] || 'bg-gray-100 text-gray-700 border-gray-200'
}

function formatLicenseDateLabel(value) {
  if (!value) return '-'
  const text = String(value).trim()
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return text
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return text || '-'
  return format(parsed, 'dd/MM/yyyy')
}

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
    if (t === 'license' || t === 'licenses') return 'license'
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
      } else if (refType === 'license') {
        const r = await licensesApi.get(refId)
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
        : detailType === 'license'
          ? 'License detail'
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
            <div className="px-4 pb-4 text-xs text-gray-500">
              Notification log entries are automatically deleted after 30 days.
            </div>
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
                {'status' in detailData && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">Status:</span>
                    <StatusBadge status={detailData.status} />
                  </div>
                )}
                {'type' in detailData && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">Type:</span>
                    <PrettyBadge value={detailData.type} classes={TYPE_BADGE[detailData.type]} />
                  </div>
                )}
                {'impact_level' in detailData && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">Impact:</span>
                    <CriticalityBadge criticality={detailData.impact_level} />
                  </div>
                )}
                {'severity' in detailData && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">Severity:</span>
                    <PrettyBadge value={detailData.severity} classes={SEVERITY_BADGE[detailData.severity]} />
                  </div>
                )}
                {'scheduled_start' in detailData && <div><span className="text-gray-500">Start:</span> <span className="font-medium">{detailData.scheduled_start ? format(new Date(detailData.scheduled_start), 'MMM dd yyyy HH:mm') : '-'}</span></div>}
                {'scheduled_end' in detailData && <div><span className="text-gray-500">End:</span> <span className="font-medium">{detailData.scheduled_end ? format(new Date(detailData.scheduled_end), 'MMM dd yyyy HH:mm') : '-'}</span></div>}
                {detailType === 'license' && (
                  <>
                    <div><span className="text-gray-500">License name:</span> <span className="font-medium">{detailData.name || '-'}</span></div>
                    <div><span className="text-gray-500">Supplier:</span> <span className="font-medium">{detailData.supplier_company || detailData.supplier || '-'}</span></div>
                    <div><span className="text-gray-500">Expiry date:</span> <span className="font-medium">{formatLicenseDateLabel(detailData.expiry_date)}</span></div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">Approval status:</span>
                      <PrettyBadge
                        value={formatLicenseStatusLabel(detailData.approval_status)}
                        classes={getLicenseStatusBadgeClasses(detailData.approval_status)}
                      />
                    </div>
                  </>
                )}
              </div>

              {'description' in detailData && (
                <div>
                  <p className="text-gray-500 mb-1">Description</p>
                  <p className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 bg-gray-50 dark:bg-gray-800/40">{detailData.description || '-'}</p>
                </div>
              )}

              {(detailData.affectedAssets || detailData.affected_assets || []).length > 0 && (
                <div>
                  <p className="text-gray-500 mb-1">Affected assets</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(detailData.affectedAssets || detailData.affected_assets || []).map((asset) => (
                      <span
                        key={asset.id}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${asset.is_direct ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
                        title={asset.is_direct ? 'Selected asset' : 'Related asset'}
                      >
                        <Server size={11} />
                        {asset.part_is_relevant && <ShieldCheck size={11} className="text-amber-600" />}
                        {asset.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(detailData.affectedServices || detailData.affected_services || []).length > 0 && (
                <div>
                  <p className="text-gray-500 mb-1">Affected services</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(detailData.affectedServices || detailData.affected_services || []).map((service) => (
                      <span
                        key={service.id}
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${service.is_direct ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
                        title={service.is_direct ? 'Selected service' : 'Related service'}
                      >
                        <Cog size={11} />{service.name}
                      </span>
                    ))}
                  </div>
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
