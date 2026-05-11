import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { servicesApi, usersApi } from '../api'
import { Plus, Search, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function Services() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('services')
  const [services, setServices] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ name: '', description: '', criticality: 'medium', sla_uptime_percent: 99.9, is_public: false, owner_id: '', system_name: '' })

  const load = useCallback(() => {
    setLoading(true)
    servicesApi.list({ search, page, limit: 20 })
      .then(r => { setServices(r.data.data); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }, [search, page])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    usersApi.list({ limit: 200 }).then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data.data || [])
      setUsers(list)
    }).catch(() => {})
  }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await servicesApi.create({
        ...form,
        owner_id: form.owner_id || undefined,
        system_name: form.system_name || undefined,
      })
      toast.success('Servizio creato')
      setShowCreate(false)
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  return (
    <Layout title="Servizi">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
            <input className="input pl-9 w-48" placeholder="Cerca..." value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }} />
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={load}><RefreshCw size={15} /></button>
            {canEdit && <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />Nuovo Servizio</button>}
          </div>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>{['Nome','Sistema','Criticità','Stato','Owner','Asset','SLA %','Pubblico'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading ? <tr><td colSpan={6} className="text-center py-8 text-gray-500">Caricamento...</td></tr>
                : services.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/services/${s.id}`} className="text-brand-600 hover:underline">{s.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{s.system_name ? <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 font-medium">{s.system_name}</span> : '—'}</td>
                    <td className="px-4 py-3"><CriticalityBadge criticality={s.criticality} /></td>
                    <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.owner_name || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-gray-500">{s.asset_count ?? 0}</td>
                    <td className="px-4 py-3 text-gray-500">{s.sla_uptime_percent}%</td>
                    <td className="px-4 py-3">{s.is_public ? '✅' : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="p-4"><Pagination page={page} limit={20} total={total} onChange={setPage} /></div>
        </div>
      </div>

      {showCreate && (
        <Modal title="Nuovo Servizio" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Nome *</label>
              <input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Descrizione</label>
              <textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Sistema / Gruppo</label>
                <input className="input" placeholder="es. ERP, Rete, Cloud" value={form.system_name} onChange={e => setForm(f => ({ ...f, system_name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Owner</label>
                <select className="input" value={form.owner_id} onChange={e => setForm(f => ({ ...f, owner_id: e.target.value }))}>
                  <option value="">— Nessuno —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.display_name} ({u.username})</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Criticità</label>
                <select className="input" value={form.criticality} onChange={e => setForm(f => ({ ...f, criticality: e.target.value }))}>
                  {['critical','high','medium','low'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">SLA %</label>
                <input className="input" type="number" step="0.01" min="0" max="100"
                  value={form.sla_uptime_percent} onChange={e => setForm(f => ({ ...f, sla_uptime_percent: parseFloat(e.target.value) }))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="public" checked={form.is_public} onChange={e => setForm(f => ({ ...f, is_public: e.target.checked }))} />
              <label htmlFor="public" className="text-sm">Visibile nella status page pubblica</label>
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
