import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { blackoutApi, servicesApi, assetsApi } from '../api'
import { Modal, ConfirmDialog } from '../components/Modal'
import { ItemPicker } from '../components/ItemPicker'
import { toast } from '../components/Toast'
import { Plus, Trash2, Pencil, Server, Cog } from 'lucide-react'
import { format } from 'date-fns'

const EMPTY_FORM = { name: '', start_date: '', end_date: '', description: '', service_ids: [], asset_ids: [] }

export default function BlackoutPeriods() {
  const [periods, setPeriods] = useState([])
  const [officeFilter, setOfficeFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [allServices, setAllServices] = useState([])
  const [allAssets, setAllAssets] = useState([])

  const load = () => blackoutApi.list().then(r => setPeriods(r.data))
  useEffect(() => { load() }, [])

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

  const toggleService = (id) => setForm(f => ({
    ...f, service_ids: f.service_ids.includes(id) ? f.service_ids.filter(x => x !== id) : [...f.service_ids, id]
  }))
  const toggleAsset = (id) => setForm(f => ({
    ...f, asset_ids: f.asset_ids.includes(id) ? f.asset_ids.filter(x => x !== id) : [...f.asset_ids, id]
  }))

  const formBody = (onSubmit, onCancel) => (
    <form onSubmit={onSubmit} className="space-y-4 p-4">
      <div><label className="block text-sm font-medium mb-1">Name *</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className="block text-sm font-medium mb-1">From *</label><input type="date" className="input" required value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
        <div><label className="block text-sm font-medium mb-1">To *</label><input type="date" className="input" required value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
      </div>
      <div><label className="block text-sm font-medium mb-1">Description</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
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

  return (
    <Layout title="Blackout Periods">
      <div className="space-y-4">
        <div className="flex justify-end">
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

        <div className="space-y-3">
          {visiblePeriods.map(p => (
            <div key={p.id} className="card p-4 cursor-pointer" onDoubleClick={() => openEdit(p)} title="Double click to edit">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-gray-500">
                    {format(new Date(p.start_date), 'MMM dd yyyy')} → {format(new Date(p.end_date), 'MMM dd yyyy')}
                  </p>
                  {p.description && <p className="text-xs text-gray-400 mt-1">{p.description}</p>}
                  {p.services?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.services.map(s => (
                        <span key={s.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          <Cog size={10} />{s.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {p.assets?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.assets.map(a => (
                        <span key={a.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                          <Server size={10} />{a.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2">
                    <p className="text-xs text-gray-500">Offices impacted: <strong>{p.offices_impacted_count || 0}</strong></p>
                    {Array.isArray(p.offices_impacted) && p.offices_impacted.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.offices_impacted.map((office) => (
                          <button
                            type="button"
                            key={office}
                            onClick={(e) => { e.stopPropagation(); setOfficeFilter(office) }}
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${officeFilter === office ? 'bg-indigo-200 text-indigo-900 dark:bg-indigo-700/60 dark:text-indigo-100' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'}`}
                          >
                            {office}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0 ml-3">
                  <button className="p-1.5 text-gray-400 hover:bg-gray-100 rounded hover:text-brand-600 transition-colors" onClick={(e) => { e.stopPropagation(); openEdit(p) }}><Pencil size={14} /></button>
                  <button className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors" onClick={(e) => { e.stopPropagation(); setDeleteTarget(p) }}><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
          {visiblePeriods.length === 0 && <p className="text-center text-gray-500 py-8">No blackout periods for current office filter</p>}
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
    </Layout>
  )
}

