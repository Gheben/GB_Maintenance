import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { templatesApi } from '../api'
import { Modal, ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { Plus, Trash2 } from 'lucide-react'

const TYPES = ['planned','emergency','upgrade','security_patch','infrastructure','other']
const IMPACTS = ['critical','high','medium','low']

export default function Templates() {
  const [templates, setTemplates] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState({ name: '', type: 'planned', impact_level: 'medium', duration_minutes: 60, description: '' })

  const load = () => templatesApi.list().then(r => setTemplates(r.data))
  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    try { await templatesApi.create(form); toast.success('Template creato'); setShowCreate(false); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const handleDelete = async () => {
    try { await templatesApi.delete(deleteTarget.id); toast.success('Eliminato'); setDeleteTarget(null); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  return (
    <Layout title="Template Manutenzione">
      <div className="space-y-4">
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />Nuovo Template</button>
        </div>

        <div className="space-y-3">
          {templates.map(t => (
            <div key={t.id} className="card p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-gray-500">{t.type} · {t.impact_level} · {t.duration_minutes} min</p>
                {t.description && <p className="text-xs text-gray-400 mt-1">{t.description}</p>}
              </div>
              <button className="p-1 text-red-500 hover:bg-red-50 rounded" onClick={() => setDeleteTarget(t)}><Trash2 size={14} /></button>
            </div>
          ))}
          {templates.length === 0 && <p className="text-center text-gray-500 py-8">Nessun template</p>}
        </div>
      </div>

      {showCreate && (
        <Modal title="Nuovo Template" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Nome *</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">Tipo</label>
                <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select></div>
              <div><label className="block text-sm font-medium mb-1">Impatto</label>
                <select className="input" value={form.impact_level} onChange={e => setForm(f => ({ ...f, impact_level: e.target.value }))}>
                  {IMPACTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select></div>
            </div>
            <div><label className="block text-sm font-medium mb-1">Durata (min)</label><input className="input" type="number" min="1" value={form.duration_minutes} onChange={e => setForm(f => ({ ...f, duration_minutes: parseInt(e.target.value) }))} /></div>
            <div><label className="block text-sm font-medium mb-1">Descrizione</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Annulla</button>
              <button type="submit" className="btn-primary">Crea</button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && <ConfirmDialog title="Elimina Template" message={`Eliminare "${deleteTarget.name}"?`} danger confirmLabel="Elimina" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />}
    </Layout>
  )
}
