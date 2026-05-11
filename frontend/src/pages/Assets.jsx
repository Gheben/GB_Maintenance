import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { assetsApi } from '../api'
import { Plus, Search, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const CATEGORIES = ['server','network','storage','application','database','service','other']
const CRITICALITIES = ['critical','high','medium','low']

export default function Assets() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('assets')
  const [assets, setAssets] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [filterCrit, setFilterCrit] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', category: 'server', criticality: 'medium', description: '' })

  const load = useCallback(() => {
    setLoading(true)
    assetsApi.list({ search, criticality: filterCrit, status: filterStatus, page, limit: 20 })
      .then(r => { setAssets(r.data.data); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }, [search, filterCrit, filterStatus, page])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await assetsApi.create(form)
      toast.success('Asset creato')
      setShowCreate(false)
      setForm({ name: '', category: 'server', criticality: 'medium', description: '' })
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  return (
    <Layout title="Asset">
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
              <input className="input pl-9 w-48" placeholder="Cerca..." value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }} />
            </div>
            <select className="input w-40" value={filterCrit} onChange={e => { setFilterCrit(e.target.value); setPage(1) }}>
              <option value="">Tutte criticità</option>
              {CRITICALITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={load}><RefreshCw size={15} /></button>
            {canEdit && <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />Nuovo Asset</button>}
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>{['Nome','Categoria','Criticità','Stato','Probe'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading ? (
                  <tr><td colSpan={5} className="text-center py-8 text-gray-500">Caricamento...</td></tr>
                ) : assets.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/assets/${a.id}`} className="text-brand-600 hover:underline">{a.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{a.category}</td>
                    <td className="px-4 py-3"><CriticalityBadge criticality={a.criticality} /></td>
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3 text-gray-500">{a.probe_enabled ? a.probe_type : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4">
            <Pagination page={page} limit={20} total={total} onChange={setPage} />
          </div>
        </div>
      </div>

      {showCreate && (
        <Modal title="Nuovo Asset" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Nome *</label>
              <input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Categoria</label>
                <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Criticità</label>
                <select className="input" value={form.criticality} onChange={e => setForm(f => ({ ...f, criticality: e.target.value }))}>
                  {CRITICALITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
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
