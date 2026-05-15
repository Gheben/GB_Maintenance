import { useState, useEffect, useCallback } from 'react'
import { Layout } from '../components/Layout'
import { auditApi } from '../api'
import { Pagination } from '../components/Pagination'
import { ClipboardList, Search, X, Trash2, RefreshCw, Loader2 } from 'lucide-react'

const ACTION_LABELS = {
  'auth:login':             'Login',
  'auth:logout':            'Logout',
  'auth:login_failed':      'Login failed',
  'user:create':            'User created',
  'user:update':            'User updated',
  'user:delete':            'User deleted',
  'group:create':           'Group created',
  'group:update':           'Group updated',
  'group:delete':           'Group deleted',
  'group:add_member':       'Member added',
  'group:remove_member':    'Member removed',
  'asset:create':           'Asset created',
  'asset:update':           'Asset updated',
  'asset:delete':           'Asset deleted',
  'service:create':         'Service created',
  'service:update':         'Service updated',
  'service:delete':         'Service deleted',
  'maintenance:create':     'Maintenance created',
  'maintenance:update':     'Maintenance updated',
  'maintenance:delete':     'Maintenance deleted',
  'maintenance:approve':    'Maintenance approved',
  'maintenance:reject':     'Maintenance rejected',
  'maintenance:start':      'Maintenance started',
  'maintenance:complete':   'Maintenance completed',
  'maintenance:cancel':     'Maintenance cancelled',
  'incident:create':        'Incident created',
  'incident:update':        'Incident updated',
  'incident:delete':        'Incident deleted',
  'settings:update':        'Settings updated',
  'apikey:create':          'API key created',
  'apikey:delete':          'API key deleted',
}

const ACTION_COLORS = {
  'auth:login':           'bg-green-100 text-green-700',
  'auth:logout':          'bg-gray-100 text-gray-500',
  'auth:login_failed':    'bg-red-100 text-red-700',
  'user:create':          'bg-purple-100 text-purple-700',
  'user:update':          'bg-yellow-100 text-yellow-700',
  'user:delete':          'bg-red-100 text-red-700',
  'group:create':         'bg-indigo-100 text-indigo-700',
  'group:update':         'bg-indigo-50 text-indigo-600',
  'group:delete':         'bg-red-50 text-red-500',
  'group:add_member':     'bg-cyan-100 text-cyan-700',
  'group:remove_member':  'bg-orange-100 text-orange-700',
  'asset:create':         'bg-teal-100 text-teal-700',
  'asset:update':         'bg-teal-50 text-teal-600',
  'asset:delete':         'bg-red-50 text-red-600',
  'service:create':       'bg-blue-100 text-blue-700',
  'service:update':       'bg-blue-50 text-blue-600',
  'service:delete':       'bg-red-50 text-red-600',
  'maintenance:create':   'bg-orange-100 text-orange-700',
  'maintenance:update':   'bg-orange-50 text-orange-600',
  'maintenance:approve':  'bg-green-100 text-green-700',
  'maintenance:reject':   'bg-red-100 text-red-700',
  'maintenance:start':    'bg-orange-200 text-orange-800',
  'maintenance:complete': 'bg-green-200 text-green-800',
  'maintenance:cancel':   'bg-gray-100 text-gray-500',
  'maintenance:delete':   'bg-red-50 text-red-600',
  'incident:create':      'bg-red-100 text-red-700',
  'incident:update':      'bg-yellow-100 text-yellow-700',
  'incident:delete':      'bg-red-50 text-red-500',
  'settings:update':      'bg-gray-200 text-gray-700',
  'apikey:create':        'bg-violet-100 text-violet-700',
  'apikey:delete':        'bg-red-50 text-red-500',
}

function ActionBadge({ action }) {
  const label = ACTION_LABELS[action] || action
  const cls = ACTION_COLORS[action] || 'bg-gray-100 text-gray-600'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>
      {label}
    </span>
  )
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z')
  return d.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'medium' })
}

export default function AuditLog() {
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({ username: '', action: '', entity_type: '', from: '', to: '' })
  const [loading, setLoading] = useState(true)
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [purgeDays, setPurgeDays] = useState(90)
  const [purging, setPurging] = useState(false)
  const [limit, setLimit] = useState(25)
  const [retentionDays, setRetentionDays] = useState(null)
  const [retentionAutoPurge, setRetentionAutoPurge] = useState(true)

  const load = useCallback((p = 1) => {
    setLoading(true)
    const params = { page: p, limit }
    if (filters.username) params.username = filters.username
    if (filters.action) params.action = filters.action
    if (filters.entity_type) params.entity_type = filters.entity_type
    if (filters.from) params.from = filters.from
    if (filters.to) params.to = filters.to + 'T23:59:59'
    auditApi.list(params)
      .then(r => {
        setEntries(r.data.data)
        setTotal(r.data.total)
        setPage(p)
        if (typeof r.data.retention_days === 'number') {
          setRetentionDays(r.data.retention_days)
          setPurgeDays((prev) => (prev === 90 ? r.data.retention_days : prev))
        }
        if (typeof r.data.retention_auto_purge === 'boolean') {
          setRetentionAutoPurge(r.data.retention_auto_purge)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filters, limit])

  useEffect(() => { load(1) }, [load])

  const clearFilters = () => setFilters({ username: '', action: '', entity_type: '', from: '', to: '' })

  const handlePurge = async () => {
    if (!window.confirm(`Delete all audit entries older than ${purgeDays} days?`)) return
    setPurging(true)
    try {
      const r = await auditApi.purge(purgeDays)
      window.alert(`Deleted ${r.data.removed} entries.`)
      load(1)
    } catch (err) {
      window.alert(err.response?.data?.error || 'Purge error')
    } finally {
      setPurging(false)
      setPurgeOpen(false)
    }
  }

  const hasFilters = Object.values(filters).some(Boolean)
  const ENTITY_TYPES = ['user','group','asset','service','maintenance','incident','settings','apikey']

  return (
    <Layout title="Audit Log">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <ClipboardList size={20} className="text-gray-500" />
            <span className="text-sm text-gray-400">{total} total entries</span>
            {retentionDays && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                Retention: {retentionDays} days{retentionAutoPurge ? ' (auto purge on)' : ' (auto purge off)'}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={() => load(page)} className="btn-secondary flex items-center gap-1.5 text-sm">
              <RefreshCw size={14} /> Refresh
            </button>
            <button onClick={() => setPurgeOpen(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 size={14} /> Purge
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="card p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[130px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">User</label>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input className="input pl-7 text-sm" placeholder="Filter by user..."
                  value={filters.username} onChange={e => setFilters(f => ({ ...f, username: e.target.value }))} />
              </div>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Action</label>
              <select className="input text-sm" value={filters.action}
                onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}>
                <option value="">All actions</option>
                {Object.entries(ACTION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Resource</label>
              <select className="input text-sm" value={filters.entity_type}
                onChange={e => setFilters(f => ({ ...f, entity_type: e.target.value }))}>
                <option value="">All resources</option>
                {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="min-w-[120px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
              <input type="date" className="input text-sm" value={filters.from}
                onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
            </div>
            <div className="min-w-[120px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
              <input type="date" className="input text-sm" value={filters.to}
                onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
            </div>
            {hasFilters && (
              <button onClick={clearFilters}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors">
                <X size={14} /> Reset
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="flex justify-center items-center py-12 text-gray-400 gap-2">
              <Loader2 size={18} className="animate-spin" /> Loading...
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-gray-400">No entries found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[600px] w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>
                    {['Date/Time','User','Action','Resource','Entity ID','IP'].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 text-xs uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {entries.map(e => (
                    <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap font-mono text-xs">{formatDate(e.created_at)}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap">{e.username}</td>
                      <td className="px-4 py-2.5"><ActionBadge action={e.action} /></td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{e.entity_type || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-400 font-mono text-xs truncate max-w-[120px]" title={e.entity_id || ''}>{e.entity_id || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{e.ip_address || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="p-4"><Pagination page={page} limit={limit} total={total} onChange={p => load(p)} onLimitChange={setLimit} /></div>
        </div>
      </div>

      {/* Purge modal */}
      {purgeOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm p-6 m-4">
            <h3 className="text-lg font-bold mb-3 flex items-center gap-2 dark:text-gray-100">
              <Trash2 size={18} className="text-red-500" /> Audit Log Purge
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">Delete all entries older than:</p>
            <div className="flex items-center gap-3 mb-6">
              <input type="number" min={1} max={3650} value={purgeDays}
                onChange={e => setPurgeDays(Number(e.target.value))} className="input w-24" />
              <span className="text-sm text-gray-600 dark:text-gray-300">days</span>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPurgeOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={handlePurge} disabled={purging}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                {purging ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
