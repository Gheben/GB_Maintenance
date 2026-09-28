import { useEffect, useState } from 'react'
import { Layout } from '../components/Layout'
import { maintenanceTypesApi } from '../api'
import { Modal, ConfirmDialog } from '../components/Modal'
import { ArrowLeft, Plus, Pencil, Save, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from '../components/Toast'

const TYPE_COLORS = [
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#10b981', '#14b8a6', '#06b6d4', '#6b7280',
]

export default function MaintenanceTypes() {
  const [types, setTypes] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [editingColor, setEditingColor] = useState('#6366f1')
  const [form, setForm] = useState({ label: '', slug: '', color: '#6366f1' })
  const [error, setError] = useState('')

  const load = () => maintenanceTypesApi.list().then(r => setTypes(Array.isArray(r.data) ? r.data : [])).catch(() => setTypes([]))
  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.label.trim()) return setError('Label is required')
    try {
      await maintenanceTypesApi.create(form)
      setShowCreate(false)
      setForm({ label: '', slug: '', color: '#6366f1' })
      toast.success('Type created')
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Error')
    }
  }

  const saveEdit = async (id) => {
    if (!editingLabel.trim()) return
    try {
      await maintenanceTypesApi.update(id, { label: editingLabel, color: editingColor })
      setEditingId(null)
      toast.success('Type updated')
      load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error')
    }
  }

  const handleDelete = async () => {
    try {
      await maintenanceTypesApi.delete(deleteTarget.id)
      toast.success('Type deleted')
      setDeleteTarget(null)
      load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error')
      setDeleteTarget(null)
    }
  }

  return (
    <Layout title="Maintenance Types">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link to="/maintenance" className="btn-secondary">
            <ArrowLeft size={15} />Back to Maintenance
          </Link>
          <button className="btn-primary" onClick={() => { setForm({ label: '', slug: '', color: '#6366f1' }); setError(''); setShowCreate(true) }}>
            <Plus size={15} />New Type
          </button>
        </div>

        <div className="card p-5 space-y-4">
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {types.map(t => (
              <div key={t.id} className="flex items-center gap-3 py-3">
                <div className="w-4 h-4 rounded-full shrink-0 border border-white shadow-sm" style={{ backgroundColor: t.color || '#6366f1' }} />
                <span className="font-mono text-xs text-gray-500 w-32 shrink-0">{t.code || t.slug}</span>
                {editingId === t.id ? (
                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                    <input
                      className="input flex-1 py-1 text-sm min-w-[120px]"
                      value={editingLabel}
                      onChange={e => setEditingLabel(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(t.id); if (e.key === 'Escape') setEditingId(null) }}
                      autoFocus
                    />
                    <div className="flex gap-1 flex-wrap items-center">
                      {TYPE_COLORS.map(c => (
                        <button key={c} type="button"
                          onClick={() => setEditingColor(c)}
                          className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${editingColor === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                          style={{ backgroundColor: c }}
                          title={c}
                        />
                      ))}
                      <input type="color" value={editingColor}
                        onChange={e => setEditingColor(e.target.value)}
                        className="w-6 h-6 rounded cursor-pointer border border-gray-300 p-0"
                        title="Custom color" />
                    </div>
                    <button className="btn-primary py-1 px-3 text-sm" onClick={() => saveEdit(t.id)}><Save size={13} />Save</button>
                    <button className="btn-secondary py-1 px-3 text-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                ) : (
                  <span className="flex-1 text-sm font-medium">{t.label}</span>
                )}
                {editingId !== t.id && (
                  <div className="flex gap-1 shrink-0">
                    <button className="action-icon-btn" onClick={() => { setEditingId(t.id); setEditingLabel(t.label); setEditingColor(t.color || '#6366f1') }}><Pencil size={13} /></button>
                    <button className="action-icon-btn action-icon-btn-danger" onClick={() => setDeleteTarget(t)}><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            ))}
            {types.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">No types configured</p>}
          </div>
        </div>
      </div>

      {showCreate && (
        <Modal title="New Maintenance Type" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Label *</label>
              <input className="input" placeholder="e.g. Security Patch" value={form.label}
                onChange={e => {
                  const label = e.target.value
                  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
                  setForm(f => ({ ...f, label, slug }))
                }} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Slug (permanent key)</label>
              <input className="input font-mono text-sm" placeholder="security_patch" value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Color</label>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="w-6 h-6 rounded-full border border-gray-300 shadow-sm flex-shrink-0" style={{ backgroundColor: form.color }} />
                {TYPE_COLORS.map(c => (
                  <button key={c} type="button"
                    onClick={() => setForm(f => ({ ...f, color: c }))}
                    className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${form.color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
                <input type="color" value={form.color}
                  onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  className="w-7 h-7 rounded cursor-pointer border border-gray-300 p-0"
                  title="Custom color" />
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Create</button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog title="Delete Type" danger confirmLabel="Delete"
          message={`Delete type "${deleteTarget.label}" (${deleteTarget.code || deleteTarget.slug})?`}
          onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
      )}
    </Layout>
  )
}
