import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { maintenanceApi, templatesApi, assetsApi } from '../api'
import { Plus, Search, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'

const TYPES = ['planned','emergency','upgrade','security_patch','infrastructure','other']
const IMPACTS = ['critical','high','medium','low']

export default function Maintenance() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterUpcoming, setFilterUpcoming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [templates, setTemplates] = useState([])
  const [form, setForm] = useState({
    title: '', type: 'planned', impact_level: 'medium', description: '',
    scheduled_start: '', scheduled_end: '', template_id: ''
  })

  const load = useCallback(() => {
    setLoading(true)
    maintenanceApi.list({ status: filterStatus, upcoming: filterUpcoming || undefined, page, limit: 20 })
      .then(r => { setItems(r.data.data); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }, [filterStatus, filterUpcoming, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { templatesApi.list().then(r => setTemplates(r.data)) }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      const payload = { ...form }
      if (!payload.template_id) delete payload.template_id
      await maintenanceApi.create(payload)
      toast.success('Manutenzione creata')
      setShowCreate(false)
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const applyTemplate = (tid) => {
    const t = templates.find(x => x.id === tid)
    if (t) setForm(f => ({ ...f, template_id: tid, type: t.type, impact_level: t.impact_level, description: t.description || f.description }))
  }

  return (
    <Layout title="Manutenzioni">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex gap-2 flex-wrap items-center">
            <select className="input w-48" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}>
              <option value="">Tutti gli stati</option>
              {['scheduled','pending_approval','in_progress','completed','cancelled','rejected'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={filterUpcoming} onChange={e => { setFilterUpcoming(e.target.checked); setPage(1) }} />
              Solo future
            </label>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={load}><RefreshCw size={15} /></button>
            <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />Nuova</button>
          </div>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>{['Titolo','Tipo','Impatto','Stato','Inizio','Fine'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading ? <tr><td colSpan={6} className="text-center py-8 text-gray-500">Caricamento...</td></tr>
                : items.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/maintenance/${m.id}`} className="text-brand-600 hover:underline">{m.title}</Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{m.type}</td>
                    <td className="px-4 py-3"><CriticalityBadge criticality={m.impact_level} /></td>
                    <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                    <td className="px-4 py-3 text-gray-500">{format(new Date(m.scheduled_start), 'dd/MM HH:mm', { locale: it })}</td>
                    <td className="px-4 py-3 text-gray-500">{format(new Date(m.scheduled_end), 'dd/MM HH:mm', { locale: it })}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="p-4"><Pagination page={page} limit={20} total={total} onChange={setPage} /></div>
        </div>
      </div>

      {showCreate && (
        <Modal title="Nuova Manutenzione" onClose={() => setShowCreate(false)} size="lg">
          <form onSubmit={handleCreate} className="space-y-4">
            {templates.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1">Template (opzionale)</label>
                <select className="input" value={form.template_id} onChange={e => applyTemplate(e.target.value)}>
                  <option value="">— Nessun template —</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">Titolo *</label>
              <input className="input" required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Tipo</label>
                <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Impatto</label>
                <select className="input" value={form.impact_level} onChange={e => setForm(f => ({ ...f, impact_level: e.target.value }))}>
                  {IMPACTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Inizio *</label>
                <input className="input" type="datetime-local" required value={form.scheduled_start} onChange={e => setForm(f => ({ ...f, scheduled_start: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Fine *</label>
                <input className="input" type="datetime-local" required value={form.scheduled_end} onChange={e => setForm(f => ({ ...f, scheduled_end: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Descrizione</label>
              <textarea className="input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Annulla</button>
              <button type="submit" className="btn-primary">Crea</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
