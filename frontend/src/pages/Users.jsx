import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { usersApi } from '../api'
import { Pagination } from '../components/Pagination'
import { Modal, ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { Plus, Trash2, Edit2 } from 'lucide-react'

const ROLES = ['admin','change_manager','operator','viewer','subscriber']

export default function Users() {
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState({ username: '', display_name: '', email: '', password: '', role: 'operator' })

  const load = () => usersApi.list({ page, limit: 20 }).then(r => { setUsers(r.data.data); setTotal(r.data.total) })
  useEffect(() => { load() }, [page])

  const handleCreate = async (e) => {
    e.preventDefault()
    try { await usersApi.create(form); toast.success('Utente creato'); setShowCreate(false); load() }
    catch (err) { toast.error(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Errore') }
  }

  const handleDelete = async () => {
    try { await usersApi.delete(deleteTarget.id); toast.success('Utente eliminato'); setDeleteTarget(null); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  return (
    <Layout title="Utenti">
      <div className="space-y-4 max-w-5xl">
        <div className="flex justify-end">
          <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />Nuovo Utente</button>
        </div>

        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>{['Username','Nome','Email','Ruolo','Stato','Azioni'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {users.map(u => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-mono text-xs">{u.username}</td>
                  <td className="px-4 py-3">{u.display_name}</td>
                  <td className="px-4 py-3 text-gray-500">{u.email}</td>
                  <td className="px-4 py-3"><span className="badge bg-gray-100 text-gray-700">{u.role}</span></td>
                  <td className="px-4 py-3">{u.is_active ? '✅' : '⛔'}</td>
                  <td className="px-4 py-3">
                    <button className="p-1 text-red-500 hover:bg-red-50 rounded" onClick={() => setDeleteTarget(u)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-4"><Pagination page={page} limit={20} total={total} onChange={setPage} /></div>
        </div>
      </div>

      {showCreate && (
        <Modal title="Nuovo Utente" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Username *</label>
                <input className="input" required value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Nome visualizzato *</label>
                <input className="input" required value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email *</label>
              <input className="input" type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password *</label>
              <input className="input" type="password" required value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ruolo</label>
              <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Annulla</button>
              <button type="submit" className="btn-primary">Crea</button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog title="Elimina Utente" message={`Eliminare "${deleteTarget.display_name}"?`} danger confirmLabel="Elimina"
          onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
      )}
    </Layout>
  )
}
