import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { apikeysApi } from '../api'
import { Modal } from '../components/Modal'
import { ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { Pagination } from '../components/Pagination'
import { Plus, Trash2, Copy } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'

export default function ApiKeys() {
  const [keys, setKeys] = useState([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [showCreate, setShowCreate] = useState(false)
  const [newKey, setNewKey] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState({ name: '', expires_at: '' })

  const total = keys.length
  const visibleKeys = keys.slice((page - 1) * limit, page * limit)

  const load = () => apikeysApi.list().then(r => setKeys(r.data))
  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      const payload = { name: form.name }
      if (form.expires_at) payload.expires_at = form.expires_at
      const res = await apikeysApi.create(payload)
      setNewKey(res.data.key)
      setShowCreate(false)
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const handleDelete = async () => {
    try { await apikeysApi.delete(deleteTarget.id); toast.success('Chiave eliminata'); setDeleteTarget(null); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  return (
    <Layout title="API Keys">
      <div className="space-y-4">
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />Nuova Chiave</button>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>{['Nome','Prefisso','Scadenza','Ultima uso','Azioni'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {visibleKeys.map(k => (
                <tr key={k.id}>
                  <td className="px-4 py-3">{k.name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{k.key_prefix}...</td>
                  <td className="px-4 py-3 text-gray-500">{k.expires_at ? format(new Date(k.expires_at), 'dd/MM/yyyy', { locale: it }) : '∞'}</td>
                  <td className="px-4 py-3 text-gray-500">{k.last_used_at ? format(new Date(k.last_used_at), 'dd/MM HH:mm', { locale: it }) : '—'}</td>
                  <td className="px-4 py-3">
                    <button className="p-1 text-red-500 hover:bg-red-50 rounded" onClick={() => setDeleteTarget(k)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
              {keys.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-gray-500">Nessuna chiave</td></tr>}
            </tbody>
          </table>
          <div className="p-4 border-t border-gray-100 dark:border-gray-700">
            <Pagination page={page} limit={limit} total={total} onChange={setPage} onLimitChange={setLimit} />
          </div>
        </div>
      </div>

      {showCreate && (
        <Modal title="Nuova API Key" onClose={() => setShowCreate(false)} size="sm">
          <form onSubmit={handleCreate} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Nome *</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">Scadenza (opzionale)</label><input type="datetime-local" className="input" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Annulla</button>
              <button type="submit" className="btn-primary">Crea</button>
            </div>
          </form>
        </Modal>
      )}

      {newKey && (
        <Modal title="Chiave creata" onClose={() => setNewKey(null)} size="sm">
          <p className="text-sm text-gray-600 mb-3">Copia questa chiave — non sarà più visualizzabile.</p>
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border">
            <code className="flex-1 text-xs break-all">{newKey}</code>
            <button onClick={() => { navigator.clipboard.writeText(newKey); toast.success('Copiata') }}>
              <Copy size={16} />
            </button>
          </div>
          <div className="flex justify-end mt-4">
            <button className="btn-primary" onClick={() => setNewKey(null)}>Ho salvato la chiave</button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog title="Elimina Chiave" message={`Eliminare "${deleteTarget.name}"?`} danger confirmLabel="Elimina"
          onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
      )}
    </Layout>
  )
}
