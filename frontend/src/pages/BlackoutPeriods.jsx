import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { blackoutApi } from '../api'
import { Modal, ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { Plus, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'

export default function BlackoutPeriods() {
  const [periods, setPeriods] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState({ name: '', start_date: '', end_date: '', description: '' })

  const load = () => blackoutApi.list().then(r => setPeriods(r.data))
  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    try { await blackoutApi.create(form); toast.success('Periodo creato'); setShowCreate(false); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const handleDelete = async () => {
    try { await blackoutApi.delete(deleteTarget.id); toast.success('Eliminato'); setDeleteTarget(null); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  return (
    <Layout title="Blackout Period">
      <div className="max-w-3xl space-y-4">
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />Nuovo Periodo</button>
        </div>

        <div className="space-y-3">
          {periods.map(p => (
            <div key={p.id} className="card p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-gray-500">
                  {format(new Date(p.start_date), 'dd MMM yyyy', { locale: it })} → {format(new Date(p.end_date), 'dd MMM yyyy', { locale: it })}
                </p>
                {p.description && <p className="text-xs text-gray-400 mt-1">{p.description}</p>}
              </div>
              <button className="p-1 text-red-500 hover:bg-red-50 rounded" onClick={() => setDeleteTarget(p)}><Trash2 size={14} /></button>
            </div>
          ))}
          {periods.length === 0 && <p className="text-center text-gray-500 py-8">Nessun periodo di blackout</p>}
        </div>
      </div>

      {showCreate && (
        <Modal title="Nuovo Blackout Period" onClose={() => setShowCreate(false)} size="sm">
          <form onSubmit={handleCreate} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Nome *</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">Da *</label><input type="date" className="input" required value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
              <div><label className="block text-sm font-medium mb-1">A *</label><input type="date" className="input" required value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
            </div>
            <div><label className="block text-sm font-medium mb-1">Descrizione</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Annulla</button>
              <button type="submit" className="btn-primary">Crea</button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && <ConfirmDialog title="Elimina Periodo" message={`Eliminare "${deleteTarget.name}"?`} danger confirmLabel="Elimina" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />}
    </Layout>
  )
}
