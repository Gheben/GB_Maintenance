import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { ItemPicker } from '../components/ItemPicker'
import { maintenanceApi, maintenanceTypesApi, assetsApi, servicesApi, blackoutApi } from '../api'
import { Plus, RefreshCw, Pencil, ChevronDown, ChevronRight as ChevronRight2, CheckCircle2, Ban, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'

const IMPACTS = ['critical','high','medium','low']

export default function Maintenance() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterUpcoming, setFilterUpcoming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [mTypes, setMTypes] = useState([])
  const [blackouts, setBlackouts] = useState([])
  const [allAssets, setAllAssets] = useState([])
  const [allServices, setAllServices] = useState([])
  const [form, setForm] = useState({
    title: '', type: 'planned', impact_level: 'medium', description: '',
    scheduled_start: '', scheduled_end: '',
    asset_ids: [], service_ids: [], owner_approval_required: false,
  })

  const load = useCallback(() => {
    setLoading(true)
    maintenanceApi.list({ status: filterStatus, upcoming: filterUpcoming || undefined, page, limit })
      .then(r => { setItems(r.data.data); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }, [filterStatus, filterUpcoming, page, limit])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    maintenanceTypesApi.list().then(r => setMTypes(r.data))
    blackoutApi.list().then(r => setBlackouts(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (showCreate) {
      assetsApi.list({ limit: 500 }).then(r => setAllAssets(Array.isArray(r.data) ? r.data : (r.data.data || [])))
      servicesApi.list({ limit: 500 }).then(r => setAllServices(Array.isArray(r.data) ? r.data : (r.data.data || [])))
    }
  }, [showCreate])

  const toggleAsset = (id) => {
    setForm(f => ({
      ...f,
      asset_ids: f.asset_ids.includes(id) ? f.asset_ids.filter(x => x !== id) : [...f.asset_ids, id]
    }))
  }
  const toggleService = (id) => {
    setForm(f => ({
      ...f,
      service_ids: f.service_ids.includes(id) ? f.service_ids.filter(x => x !== id) : [...f.service_ids, id]
    }))
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      const payload = { ...form }
      if (!payload.asset_ids.length) delete payload.asset_ids
      if (!payload.service_ids.length) delete payload.service_ids
      await maintenanceApi.create(payload)
      toast.success('Maintenance created')
      setShowCreate(false)
      setForm({ title: '', type: 'planned', impact_level: 'medium', description: '', scheduled_start: '', scheduled_end: '', asset_ids: [], service_ids: [], owner_approval_required: false })
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const now = new Date()
  const activeBlackouts = blackouts.filter(b => {
    const start = new Date(b.start_date)
    const end = new Date(b.end_date)
    end.setHours(23, 59, 59, 999)
    return start <= now && end >= now
  })
  const upcomingBlackouts = blackouts.filter(b => new Date(b.start_date) > now)

  return (
    <Layout title="Maintenance">
      <div className="space-y-4">
        {activeBlackouts.map(b => (
          <div key={b.id} className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 p-4 flex items-start gap-3">
            <Ban size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-700 dark:text-red-300">Active blackout: {b.name}</p>
              {b.description && <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">{b.description}</p>}
              <p className="text-xs text-red-500 mt-1">{format(new Date(b.start_date), 'MMM dd')} – {format(new Date(b.end_date), 'MMM dd, yyyy')} · Planned changes may be blocked.</p>
            </div>
          </div>
        ))}
        {upcomingBlackouts.map(b => (
          <div key={b.id} className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-700 dark:text-amber-300">Upcoming blackout: {b.name}</p>
              {b.description && <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">{b.description}</p>}
              <p className="text-xs text-amber-500 mt-1">Starts on {format(new Date(b.start_date), 'MMM dd, yyyy')}</p>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex gap-2 flex-wrap items-center">
            <select className="input w-48" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}>
              <option value="">All statuses</option>
              {['scheduled','pending_approval','in_progress','completed','cancelled','rejected'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={filterUpcoming} onChange={e => { setFilterUpcoming(e.target.checked); setPage(1) }} />
              Upcoming only
            </label>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={load}><RefreshCw size={15} /></button>
            <Link to="/maintenance/types" className="btn-secondary">Types</Link>
            <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />New</button>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="min-w-[700px] w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>{['Title','Type','Impact','Status','Assets','Start','End',''].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading ? <tr><td colSpan={8} className="text-center py-8 text-gray-500">Loading...</td></tr>
                : items.map(m => {
                  const isCompleted = m.status === 'completed'
                  const isExpanded = expandedId === m.id
                  return (
                    <>
                      <tr key={m.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${isCompleted ? 'cursor-pointer' : ''}`}
                        onClick={isCompleted ? () => setExpandedId(isExpanded ? null : m.id) : undefined}>
                        <td className="px-4 py-3 font-medium">
                          {isCompleted ? (
                            <span className="flex items-center gap-1">
                              <ChevronDown size={14} className={`text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-0' : '-rotate-90'}`} />
                              <Link to={`/maintenance/${m.id}`} className="action-link text-sm" onClick={e => e.stopPropagation()}>{m.title}</Link>
                            </span>
                          ) : (
                            <Link to={`/maintenance/${m.id}`} className="action-link text-sm">{m.title}</Link>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{m.type}</td>
                        <td className="px-4 py-3"><CriticalityBadge criticality={m.impact_level} /></td>
                        <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                        <td className="px-4 py-3 text-center">
                          {m.asset_count > 0
                            ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">{m.asset_count}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{format(new Date(m.scheduled_start), 'MM/dd HH:mm')}</td>
                        <td className="px-4 py-3 text-gray-500">{format(new Date(m.scheduled_end), 'MM/dd HH:mm')}</td>
                        <td className="px-4 py-3">
                          <button onClick={e => { e.stopPropagation(); navigate(`/maintenance/${m.id}`) }} className="action-icon-btn" title="Edit"><Pencil size={14} /></button>
                        </td>
                      </tr>
                      {isCompleted && isExpanded && (
                        <tr key={`${m.id}-exp`} className="bg-gray-50 dark:bg-gray-800/60">
                          <td colSpan={8} className="px-8 py-3">
                            <div className="flex flex-wrap items-center gap-0">
                              {[
                                { label: 'Created', ts: m.created_at, color: 'bg-gray-400' },
                                { label: 'Approved', ts: m.approved_at, color: 'bg-blue-500' },
                                { label: 'Started', ts: m.actual_start, color: 'bg-orange-500' },
                                { label: 'Completed', ts: m.actual_end, color: 'bg-green-500' },
                              ].map((step, idx, arr) => (
                                <div key={step.label} className="flex items-center">
                                  <div className="flex flex-col items-center">
                                    <div className={`w-3 h-3 rounded-full ${step.ts ? step.color : 'bg-gray-200'} flex-shrink-0`} />
                                    <span className={`text-xs font-medium mt-1 ${step.ts ? 'text-gray-700 dark:text-gray-200' : 'text-gray-300'}`}>{step.label}</span>
                                    {step.ts && <span className="text-xs text-gray-400">{format(new Date(step.ts), 'MM/dd HH:mm')}</span>}
                                  </div>
                                  {idx < arr.length - 1 && (
                                    <div className="w-16 h-px bg-gray-300 dark:bg-gray-600 mx-2 mb-5" />
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
            </tbody>
          </table>
          </div>
          <div className="p-4"><Pagination page={page} limit={limit} total={total} onChange={setPage} onLimitChange={setLimit} /></div>
        </div>
      </div>

      {showCreate && (
        <Modal title="New Maintenance" onClose={() => setShowCreate(false)} size="lg">
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title *</label>
              <input className="input" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  {mTypes.map(t => <option key={t.slug} value={t.slug}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Impact</label>
                <select className="input" value={form.impact_level} onChange={e => setForm(f => ({ ...f, impact_level: e.target.value }))}>
                  {IMPACTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Start *</label>
                <input className="input" type="datetime-local" required value={form.scheduled_start} onChange={e => setForm(f => ({ ...f, scheduled_start: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">End *</label>
                <input className="input" type="datetime-local" required value={form.scheduled_end} onChange={e => setForm(f => ({ ...f, scheduled_end: e.target.value }))} />
              </div>
            </div>

            <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 space-y-4 bg-gray-50 dark:bg-gray-800/50">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Assets and Services</p>
              <ItemPicker
                label="Assets"
                allItems={allAssets}
                selectedIds={form.asset_ids}
                onToggle={toggleAsset}
                badgeKey="category"
              />
              <ItemPicker
                label="Services"
                allItems={allServices}
                selectedIds={form.service_ids}
                onToggle={toggleService}
                badgeKey="criticality"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 dark:bg-amber-900/20 px-3 py-2">
              <label className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
                <input
                  type="checkbox"
                  checked={!!form.owner_approval_required}
                  onChange={e => setForm(f => ({ ...f, owner_approval_required: e.target.checked }))}
                />
                Requires owner approval workflow
              </label>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                Owners of linked assets/services will receive notification and email to approve, reject, or propose a new date.
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Create</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}

