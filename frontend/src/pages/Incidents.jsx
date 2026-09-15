import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { Modal, ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { ItemPicker } from '../components/ItemPicker'
import { PartIsAssetNotice } from '../components/PartIsAssetNotice'
import { PartIsServiceNotice } from '../components/PartIsServiceNotice'
import { incidentsApi, assetsApi, servicesApi, incidentSeveritiesApi } from '../api'
import { Plus, RefreshCw, Pencil, Trash2, Search, Cog, Server } from 'lucide-react'
import { format } from 'date-fns'
import { useAuth } from '../contexts/AuthContext'

const SEVERITIES = ['critical','high','medium','low']

export default function Incidents() {
  const { hasRole } = useAuth()
  const canBulkDelete = hasRole('superadmin', 'admin')
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [selectedIncidentIds, setSelectedIncidentIds] = useState([])
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [form, setForm] = useState({ title: '', severity: 'high', description: '', ticket_ref: '' })
  const [allAssets, setAllAssets] = useState([])
  const [allServices, setAllServices] = useState([])
  const [createAssetIds, setCreateAssetIds] = useState([])
  const [createServiceIds, setCreateServiceIds] = useState([])
  const [editAssetIds, setEditAssetIds] = useState([])
  const [editServiceIds, setEditServiceIds] = useState([])
  const [severityDefs, setSeverityDefs] = useState([])

  const load = useCallback(() => {
    setLoading(true)
    incidentsApi.list({ status: filterStatus, search: search.trim() || undefined, page, limit })
      .then(r => { setItems(r.data.data); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }, [filterStatus, search, page, limit])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    setSelectedIncidentIds(prev => prev.filter(id => items.some(i => i.id === id)))
  }, [items])

  useEffect(() => {
    if (showCreate || editTarget) {
      assetsApi.list({ limit: 500 }).then(r => setAllAssets(Array.isArray(r.data) ? r.data : (r.data.data || []))).catch(() => {})
      servicesApi.list({ limit: 500 }).then(r => setAllServices(Array.isArray(r.data) ? r.data : (r.data.data || []))).catch(() => {})
    }
  }, [showCreate, editTarget])

  useEffect(() => {
    incidentSeveritiesApi.list()
      .then((r) => {
        const rows = Array.isArray(r.data) ? r.data : []
        setSeverityDefs(rows)
        if (rows.length > 0) {
          setForm((prev) => {
            if (rows.some((s) => s.slug === prev.severity)) return prev
            return { ...prev, severity: rows[0].slug }
          })
        }
      })
      .catch(() => setSeverityDefs([]))
  }, [])

  const severityOptions = severityDefs.length > 0 ? severityDefs.map((s) => s.slug) : SEVERITIES

  const severityMeta = (slug) => {
    const found = severityDefs.find((s) => s.slug === slug)
    return {
      label: found?.label || slug,
      color: found?.color || '#6b7280',
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await incidentsApi.create({ ...form, asset_ids: createAssetIds, service_ids: createServiceIds })
      toast.success('Incident created')
      setShowCreate(false)
      setForm({ title: '', severity: 'high', description: '', ticket_ref: '' })
      setCreateAssetIds([])
      setCreateServiceIds([])
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const openEdit = (i) => {
    setEditTarget(i)
    setForm({ title: i.title, severity: i.severity, description: i.description || '', ticket_ref: i.ticket_ref || '' })
    setEditAssetIds(i.assets?.map(a => a.id) || [])
    setEditServiceIds(i.services?.map(s => s.id) || [])
  }

  const handleEdit = async (e) => {
    e.preventDefault()
    try {
      await incidentsApi.update(editTarget.id, { ...form, asset_ids: editAssetIds, service_ids: editServiceIds })
      toast.success('Incident updated')
      setEditTarget(null)
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const toggleIncidentSelection = (id) => {
    if (!canBulkDelete) return
    setSelectedIncidentIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleSelectAllVisible = (checked) => {
    if (!canBulkDelete) return
    setSelectedIncidentIds(checked ? items.map(i => i.id) : [])
  }

  const handleBulkDelete = async () => {
    if (!canBulkDelete || selectedIncidentIds.length === 0) return
    setBulkDeleting(true)
    try {
      const results = await Promise.allSettled(selectedIncidentIds.map(id => incidentsApi.delete(id)))
      const deleted = results.filter(r => r.status === 'fulfilled').length
      const failedIds = selectedIncidentIds.filter((_, index) => results[index].status === 'rejected')
      if (deleted > 0) toast.success(`${deleted} incident(s) deleted`)
      if (failedIds.length > 0) {
        toast.error(`${failedIds.length} incident(s) could not be deleted`)
        setSelectedIncidentIds(failedIds)
      } else {
        setSelectedIncidentIds([])
        setConfirmBulkDelete(false)
      }
      load()
    } finally {
      setBulkDeleting(false)
    }
  }

  const allVisibleSelected = items.length > 0 && items.every(i => selectedIncidentIds.includes(i.id))

  return (
    <Layout title="Incidents">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
            <input className="input pl-9 w-48" placeholder="Search..." value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }} />
          </div>
          <div className="flex gap-2">
            <select className="input w-48" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}>
              <option value="">All statuses</option>
              {['investigating','identified','monitoring','resolved'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn-secondary" onClick={load}><RefreshCw size={15} /></button>
            {canBulkDelete && (
              <button className="btn-danger" disabled={selectedIncidentIds.length === 0 || bulkDeleting} onClick={() => setConfirmBulkDelete(true)}>
                <Trash2 size={15} />Delete selected ({selectedIncidentIds.length})
              </button>
            )}
            <Link to="/incidents/severities" className="btn-secondary">Severity</Link>
            <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />New Incident</button>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="min-w-[700px] w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                {canBulkDelete && (
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(e) => toggleSelectAllVisible(e.target.checked)}
                      aria-label="Select all visible incidents"
                    />
                  </th>
                )}
                {['Title','Severity','Status','Assets','Services','Opened','Resolved',''].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading ? <tr><td colSpan={canBulkDelete ? 7 : 6} className="text-center py-8 text-gray-500">Loading...</td></tr>
                : items.map(i => (
                  <tr key={i.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer" onDoubleClick={() => navigate(`/incidents/${i.id}`)} title="Double click to open">
                    {canBulkDelete && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIncidentIds.includes(i.id)}
                          onChange={() => toggleIncidentSelection(i.id)}
                          aria-label={`Select incident ${i.title}`}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 font-medium">
                      <span className="text-sm text-gray-800 dark:text-gray-100">{i.title}</span>
                      {i.ticket_ref && <div className="text-xs text-brand-600 mt-0.5">Ticket: {i.ticket_ref}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={{
                          color: severityMeta(i.severity).color,
                          backgroundColor: `${severityMeta(i.severity).color}22`,
                        }}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: severityMeta(i.severity).color }} />
                        {severityMeta(i.severity).label}
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={i.status} /></td>
                    <td className="px-4 py-3 text-center">
                      {i.asset_count > 0
                        ? <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700"><Cog size={11} />{i.asset_count}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {i.service_count > 0
                        ? <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700"><Server size={11} />{i.service_count}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{format(new Date(i.started_at), 'MM/dd HH:mm')}</td>
                    <td className="px-4 py-3 text-gray-500">{i.resolved_at ? format(new Date(i.resolved_at), 'MM/dd HH:mm') : '—'}</td>
                    <td className="px-4 py-3">
                      <button onClick={(e) => { e.stopPropagation(); openEdit(i) }} className="action-icon-btn" title="Edit">
                        <Pencil size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          </div>
          <div className="p-4"><Pagination page={page} limit={limit} total={total} onChange={setPage} onLimitChange={setLimit} /></div>
        </div>
      </div>

      {showCreate && (
        <Modal title="New Incident" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <PartIsAssetNotice assets={allAssets} selectedIds={createAssetIds} />
            <PartIsServiceNotice services={allServices} selectedIds={createServiceIds} />
            <div>
              <label className="block text-sm font-medium mb-1">Title *</label>
              <input className="input" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Severity</label>
              <select className="input" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                {severityOptions.map(s => <option key={s} value={s}>{severityMeta(s).label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ticket ref</label>
              <input className="input" value={form.ticket_ref} onChange={e => setForm(f => ({ ...f, ticket_ref: e.target.value }))} placeholder="e.g., TKT-12345" />
            </div>
            <ItemPicker
              label="Affected Assets"
              allItems={allAssets}
              selectedIds={createAssetIds}
              onToggle={id => setCreateAssetIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])}
              badgeKey="category"
              filterKey="category"
              useModal
              maxResults={120}
            />
            <ItemPicker
              label="Affected Services"
              allItems={allServices}
              selectedIds={createServiceIds}
              onToggle={id => setCreateServiceIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])}
              badgeKey="criticality"
              filterKey="criticality"
              useModal
              maxResults={120}
            />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Create</button>
            </div>
          </form>
        </Modal>
      )}

      {editTarget && (
        <Modal title={`Edit Incident: ${editTarget.title}`} onClose={() => setEditTarget(null)}>
          <form onSubmit={handleEdit} className="space-y-4">
            <PartIsAssetNotice assets={allAssets} selectedIds={editAssetIds} />
            <PartIsServiceNotice services={allServices} selectedIds={editServiceIds} />
            <div>
              <label className="block text-sm font-medium mb-1">Title *</label>
              <input className="input" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Severity</label>
              <select className="input" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                {severityOptions.map(s => <option key={s} value={s}>{severityMeta(s).label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ticket ref</label>
              <input className="input" value={form.ticket_ref} onChange={e => setForm(f => ({ ...f, ticket_ref: e.target.value }))} placeholder="e.g., TKT-12345" />
            </div>
            <ItemPicker
              label="Affected Assets"
              allItems={allAssets}
              selectedIds={editAssetIds}
              onToggle={id => setEditAssetIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])}
              badgeKey="category"
              filterKey="category"
              useModal
              maxResults={120}
            />
            <ItemPicker
              label="Affected Services"
              allItems={allServices}
              selectedIds={editServiceIds}
              onToggle={id => setEditServiceIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])}
              badgeKey="criticality"
              filterKey="criticality"
              useModal
              maxResults={120}
            />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}

      {confirmBulkDelete && (
        <ConfirmDialog
          title="Delete Selected Incidents"
          message={`Delete ${selectedIncidentIds.length} selected incident(s)? This action cannot be undone.`}
          danger
          confirmLabel={bulkDeleting ? 'Deleting...' : 'Delete'}
          onConfirm={handleBulkDelete}
          onCancel={() => !bulkDeleting && setConfirmBulkDelete(false)}
        />
      )}
    </Layout>
  )
}
