import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { blackoutApi, servicesApi, assetsApi } from '../api'
import { Modal, ConfirmDialog } from '../components/Modal'
import { ItemPicker } from '../components/ItemPicker'
import { PartIsAssetNotice } from '../components/PartIsAssetNotice'
import { PartIsServiceNotice } from '../components/PartIsServiceNotice'
import { Pagination } from '../components/Pagination'
import { toast } from '../components/Toast'
import { Plus, Trash2, Pencil, Server, Cog, ShieldCheck, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { useAuth } from '../contexts/AuthContext'

const EMPTY_FORM = { name: '', start_date: '', end_date: '', description: '', ticket_ref: '', service_ids: [], asset_ids: [] }

export default function BlackoutPeriods() {
  const { hasRole } = useAuth()
  const canBulkDelete = hasRole('superadmin', 'admin')
  const [periods, setPeriods] = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [selectedPeriodIds, setSelectedPeriodIds] = useState([])
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [officeFilter, setOfficeFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [allServices, setAllServices] = useState([])
  const [allAssets, setAllAssets] = useState([])

  const load = () => {
    setLoading(true)
    return blackoutApi.list().then(r => setPeriods(r.data)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => { setSelectedPeriodIds(previous => previous.filter(id => periods.some(period => period.id === id))) }, [periods])

  // Load services & assets when a modal is opened
  useEffect(() => {
    if (showCreate || editTarget) {
      servicesApi.list({ limit: 500 }).then(r => setAllServices(Array.isArray(r.data) ? r.data : (r.data.data || [])))
      assetsApi.list({ limit: 500 }).then(r => setAllAssets(Array.isArray(r.data) ? r.data : (r.data.data || [])))
    }
  }, [showCreate, editTarget])

  const handleCreate = async (e) => {
    e.preventDefault()
    try { await blackoutApi.create(form); toast.success('Period created'); setShowCreate(false); setForm(EMPTY_FORM); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const openEdit = (p) => {
    setEditTarget(p)
    setForm({
      name: p.name,
      start_date: p.start_date?.slice(0,10) || '',
      end_date: p.end_date?.slice(0,10) || '',
      description: p.description || '',
      ticket_ref: p.ticket_ref || '',
      service_ids: p.services?.map(s => s.id) || p.service_ids || [],
      asset_ids:   p.assets?.map(a => a.id)   || p.asset_ids   || [],
    })
  }

  const handleEdit = async (e) => {
    e.preventDefault()
    try { await blackoutApi.update(editTarget.id, form); toast.success('Period updated'); setEditTarget(null); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const handleDelete = async () => {
    try { await blackoutApi.delete(deleteTarget.id); toast.success('Deleted'); setDeleteTarget(null); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const togglePeriodSelection = (id) => {
    if (!canBulkDelete) return
    setSelectedPeriodIds(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])
  }

  const toggleSelectAllVisible = (checked) => {
    if (!canBulkDelete) return
    setSelectedPeriodIds(checked ? visiblePeriods.map(period => period.id) : [])
  }

  const handleBulkDelete = async () => {
    if (!canBulkDelete || selectedPeriodIds.length === 0) return
    setBulkDeleting(true)
    try {
      const results = await Promise.allSettled(selectedPeriodIds.map(id => blackoutApi.delete(id)))
      const deleted = results.filter(result => result.status === 'fulfilled').length
      const failedIds = selectedPeriodIds.filter((_, index) => results[index].status === 'rejected')
      if (deleted > 0) toast.success(`${deleted} blackout period(s) deleted`)
      if (failedIds.length > 0) {
        toast.error(`${failedIds.length} blackout period(s) could not be deleted`)
        setSelectedPeriodIds(failedIds)
      } else {
        setSelectedPeriodIds([])
        setConfirmBulkDelete(false)
      }
      load()
    } finally {
      setBulkDeleting(false)
    }
  }

  const toggleService = (id) => setForm(f => ({
    ...f, service_ids: f.service_ids.includes(id) ? f.service_ids.filter(x => x !== id) : [...f.service_ids, id]
  }))
  const toggleAsset = (id) => setForm(f => ({
    ...f, asset_ids: f.asset_ids.includes(id) ? f.asset_ids.filter(x => x !== id) : [...f.asset_ids, id]
  }))

  const formBody = (onSubmit, onCancel) => (
    <form onSubmit={onSubmit} className="space-y-4 p-4">
      <PartIsAssetNotice assets={allAssets} selectedIds={form.asset_ids} />
      <PartIsServiceNotice services={allServices} selectedIds={form.service_ids} />
      <div><label className="block text-sm font-medium mb-1">Name *</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className="block text-sm font-medium mb-1">From *</label><input type="date" className="input" required value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
        <div><label className="block text-sm font-medium mb-1">To *</label><input type="date" className="input" required value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
      </div>
      <div><label className="block text-sm font-medium mb-1">Description</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
      <div><label className="block text-sm font-medium mb-1">Ticket ref</label><input className="input" value={form.ticket_ref} onChange={e => setForm(f => ({ ...f, ticket_ref: e.target.value }))} placeholder="e.g., TKT-12345" /></div>
      <ItemPicker
        label="Affected Services"
        allItems={allServices}
        selectedIds={form.service_ids}
        onToggle={toggleService}
        nameKey="name"
        badgeKey="status"
        useModal
        filterKey="status"
      />
      <ItemPicker
        label="Affected Assets"
        allItems={allAssets}
        selectedIds={form.asset_ids}
        onToggle={toggleAsset}
        nameKey="name"
        badgeKey="category"
        useModal
        filterKey="category"
      />
      <div className="flex justify-end gap-3 pt-1">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary">Save</button>
      </div>
    </form>
  )

  const allOffices = [...new Set(periods.flatMap((p) => (Array.isArray(p.offices_impacted) ? p.offices_impacted : [])).map((o) => String(o || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const visiblePeriods = officeFilter
    ? periods.filter((p) => Array.isArray(p.offices_impacted) && p.offices_impacted.includes(officeFilter))
    : periods
  const total = visiblePeriods.length
  const pageCount = Math.max(1, Math.ceil(total / limit))
  const currentPage = Math.min(page, pageCount)
  const pagedPeriods = visiblePeriods.slice((currentPage - 1) * limit, currentPage * limit)
  const allVisibleSelected = pagedPeriods.length > 0 && pagedPeriods.every(period => selectedPeriodIds.includes(period.id))

  useEffect(() => { setPage(1) }, [officeFilter, limit])

  return (
    <Layout title="Blackout Periods">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button className="btn-secondary" onClick={load}><RefreshCw size={15} /></button>
          {canBulkDelete && (
            <button className="btn-danger" disabled={selectedPeriodIds.length === 0 || bulkDeleting} onClick={() => setConfirmBulkDelete(true)}>
              <Trash2 size={15} />Delete selected ({selectedPeriodIds.length})
            </button>
          )}
          <button className="btn-primary" onClick={() => { setForm(EMPTY_FORM); setShowCreate(true) }}><Plus size={15} />New Period</button>
        </div>

        {allOffices.length > 0 && (
          <div className="card p-3">
            <p className="text-xs font-medium text-gray-500 mb-2">Offices impacted filter</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setOfficeFilter('')}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs border ${officeFilter === '' ? 'bg-brand-100 text-brand-700 border-brand-200' : 'bg-white text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'}`}
              >
                All offices
              </button>
              {allOffices.map((office) => (
                <button
                  type="button"
                  key={office}
                  onClick={() => setOfficeFilter(office)}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${officeFilter === office ? 'bg-indigo-200 text-indigo-900 dark:bg-indigo-700/60 dark:text-indigo-100' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'}`}
                >
                  {office}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50"><tr>
                {canBulkDelete && <th className="text-left px-4 py-3 font-medium text-gray-600 w-10"><input type="checkbox" checked={allVisibleSelected} onChange={event => toggleSelectAllVisible(event.target.checked)} aria-label="Select all visible blackout periods" /></th>}
                {['Name','Period','Services','Assets','Offices',''].map(header => <th key={header} className="text-left px-4 py-3 font-medium text-gray-600">{header}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading ? <tr><td colSpan={canBulkDelete ? 7 : 6} className="py-8 text-center text-gray-500">Loading...</td></tr> : pagedPeriods.map(period => (
                  <tr key={period.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50" onDoubleClick={() => openEdit(period)} title="Double click to edit">
                    {canBulkDelete && <td className="px-4 py-3" onClick={event => event.stopPropagation()}><input type="checkbox" checked={selectedPeriodIds.includes(period.id)} onChange={() => togglePeriodSelection(period.id)} aria-label={`Select blackout period ${period.name}`} /></td>}
                    <td className="px-4 py-3"><p className="font-medium">{period.name}</p>{period.ticket_ref && <p className="mt-0.5 text-xs text-brand-600">Ticket: {period.ticket_ref}</p>}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{format(new Date(period.start_date), 'MM/dd/yyyy')} - {format(new Date(period.end_date), 'MM/dd/yyyy')}</td>
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700"><Cog size={11} />{period.services?.length || 0}</span></td>
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700"><Server size={11} />{period.assets?.length || 0}{period.assets?.some(asset => asset.part_is_relevant) && <ShieldCheck size={11} className="text-amber-600" title="Part-IS Relevant" />}</span></td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{(period.offices_impacted || []).map(office => <button type="button" key={office} onClick={() => setOfficeFilter(office)} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{office}</button>)}{(period.offices_impacted || []).length === 0 && <span className="text-gray-300">-</span>}</div></td>
                    <td className="px-4 py-3"><div className="flex gap-1"><button className="action-icon-btn" onClick={() => openEdit(period)} title="Edit"><Pencil size={14} /></button>{canBulkDelete && <button className="action-icon-btn text-red-500 hover:text-red-600" onClick={() => setDeleteTarget(period)} title="Delete"><Trash2 size={14} /></button>}</div></td>
                  </tr>
                ))}
                {!loading && pagedPeriods.length === 0 && <tr><td colSpan={canBulkDelete ? 7 : 6} className="py-8 text-center text-gray-500">No blackout periods for current office filter</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="p-4"><Pagination page={currentPage} limit={limit} total={total} onChange={setPage} onLimitChange={setLimit} /></div>
        </div>
      </div>

      {showCreate && (
        <Modal title="New Blackout Period" onClose={() => setShowCreate(false)}>
          {formBody(handleCreate, () => setShowCreate(false))}
        </Modal>
      )}

      {editTarget && (
        <Modal title={`Edit: ${editTarget.name}`} onClose={() => setEditTarget(null)}>
          {formBody(handleEdit, () => setEditTarget(null))}
        </Modal>
      )}

      {deleteTarget && <ConfirmDialog title="Delete Period" message={`Delete "${deleteTarget.name}"?`} danger confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />}
      {confirmBulkDelete && <ConfirmDialog title="Delete Selected Blackout Periods" message={`Delete ${selectedPeriodIds.length} selected blackout period(s)? This action cannot be undone.`} danger confirmLabel={bulkDeleting ? 'Deleting...' : 'Delete'} onConfirm={handleBulkDelete} onCancel={() => !bulkDeleting && setConfirmBulkDelete(false)} />}
    </Layout>
  )
}

