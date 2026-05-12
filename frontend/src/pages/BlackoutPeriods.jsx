import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { blackoutApi } from '../api'
import { Modal, ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { format } from 'date-fns'

export default function BlackoutPeriods() {
  const [periods, setPeriods] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '', description: '' })

  const load = () => blackoutApi.list().then(r => setPeriods(r.data))
  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    try { await blackoutApi.create(form); toast.success('Period created'); setShowCreate(false); setForm({ name: '', start_date: '', end_date: '', description: '' }); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const openEdit = (p) => {
    setEditTarget(p)
    setForm({ name: p.name, start_date: p.start_date?.slice(0,10) || '', end_date: p.end_date?.slice(0,10) || '', description: p.description || '' })
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

  return (
    <Layout title="Blackout Periods">
      <div className="max-w-3xl space-y-4">
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => { setForm({ name: '', start_date: '', end_date: '', description: '' }); setShowCreate(true) }}><Plus size={15} />New Period</button>
        </div>

        <div className="space-y-3">
          {periods.map(p => (
            <div key={p.id} className="card p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-gray-500">
                  {format(new Date(p.start_date), 'MMM dd yyyy')} → {format(new Date(p.end_date), 'MMM dd yyyy')}
                </p>
                {p.description && <p className="text-xs text-gray-400 mt-1">{p.description}</p>}
              </div>
              <div className="flex gap-1">
                <button className="p-1.5 text-gray-400 hover:bg-gray-100 rounded hover:text-brand-600 transition-colors" onClick={() => openEdit(p)}><Pencil size={14} /></button>
                <button className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors" onClick={() => setDeleteTarget(p)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {periods.length === 0 && <p className="text-center text-gray-500 py-8">No blackout periods</p>}
        </div>
      </div>

      {showCreate && (
        <Modal title="New Blackout Period" onClose={() => setShowCreate(false)} size="sm">
          <form onSubmit={handleCreate} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Name *</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">From *</label><input type="date" className="input" required value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
              <div><label className="block text-sm font-medium mb-1">To *</label><input type="date" className="input" required value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
            </div>
            <div><label className="block text-sm font-medium mb-1">Description</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Create</button>
            </div>
          </form>
        </Modal>
      )}

      {editTarget && (
        <Modal title={`Edit Period: ${editTarget.name}`} onClose={() => setEditTarget(null)} size="sm">
          <form onSubmit={handleEdit} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Name *</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">From *</label><input type="date" className="input" required value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
              <div><label className="block text-sm font-medium mb-1">To *</label><input type="date" className="input" required value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
            </div>
            <div><label className="block text-sm font-medium mb-1">Description</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && <ConfirmDialog title="Delete Period" message={`Delete "${deleteTarget.name}"?`} danger confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />}
    </Layout>
  )
}


