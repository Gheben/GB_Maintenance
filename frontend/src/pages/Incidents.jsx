import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { incidentsApi } from '../api'
import { Plus, RefreshCw, Pencil } from 'lucide-react'
import { format } from 'date-fns'

const SEVERITIES = ['critical','high','medium','low']

export default function Incidents() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filterStatus, setFilterStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState({ title: '', severity: 'high', description: '' })

  const load = useCallback(() => {
    setLoading(true)
    incidentsApi.list({ status: filterStatus, page, limit: 20 })
      .then(r => { setItems(r.data.data); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }, [filterStatus, page])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await incidentsApi.create(form)
      toast.success('Incident created')
      setShowCreate(false)
      setForm({ title: '', severity: 'high', description: '' })
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const openEdit = (i) => {
    setEditTarget(i)
    setForm({ title: i.title, severity: i.severity, description: i.description || '' })
  }

  const handleEdit = async (e) => {
    e.preventDefault()
    try {
      await incidentsApi.update(editTarget.id, form)
      toast.success('Incident updated')
      setEditTarget(null)
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  return (
    <Layout title="Incidents">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <select className="input w-48" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}>
            <option value="">All statuses</option>
            {['investigating','identified','monitoring','resolved'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={load}><RefreshCw size={15} /></button>
            <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />New Incident</button>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="min-w-[640px] w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>{['Title','Severity','Status','Opened','Resolved',''].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading ? <tr><td colSpan={6} className="text-center py-8 text-gray-500">Loading...</td></tr>
                : items.map(i => (
                  <tr key={i.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/incidents/${i.id}`} className="text-brand-600 hover:underline">{i.title}</Link>
                    </td>
                    <td className="px-4 py-3"><CriticalityBadge criticality={i.severity} /></td>
                    <td className="px-4 py-3"><StatusBadge status={i.status} /></td>
                    <td className="px-4 py-3 text-gray-500">{format(new Date(i.started_at), 'MM/dd HH:mm')}</td>
                    <td className="px-4 py-3 text-gray-500">{i.resolved_at ? format(new Date(i.resolved_at), 'MM/dd HH:mm') : '—'}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => openEdit(i)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-400 hover:text-brand-600 transition-colors">
                        <Pencil size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          </div>
          <div className="p-4"><Pagination page={page} limit={20} total={total} onChange={setPage} /></div>
        </div>
      </div>

      {showCreate && (
        <Modal title="New Incident" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title *</label>
              <input className="input" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Severity</label>
              <select className="input" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
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
            <div>
              <label className="block text-sm font-medium mb-1">Title *</label>
              <input className="input" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Severity</label>
              <select className="input" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
