import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { usersApi, groupsApi } from '../api'
import { Pagination } from '../components/Pagination'
import { Modal, ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { Plus, Trash2, Users as UsersIcon, ChevronRight } from 'lucide-react'

const ROLES = ['admin','change_manager','operator','viewer','subscriber']
const TABS = [
  { id: 'users', label: 'Utenti' },
  { id: 'groups', label: 'Gruppi Locali' },
]

// â”€â”€â”€ Tab Utenti â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function UsersTab() {
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState({ username: '', display_name: '', email: '', password: '', role: 'operator' })

  const load = () => usersApi.list({ page, limit: 20 }).then(r => {
    const list = Array.isArray(r.data) ? r.data : (r.data.data || [])
    const tot  = Array.isArray(r.data) ? r.data.length : (r.data.total || r.data.length || 0)
    setUsers(list); setTotal(tot)
  })
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
    <div className="space-y-4">
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
              <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3 font-mono text-xs">{u.username}</td>
                <td className="px-4 py-3">{u.display_name}</td>
                <td className="px-4 py-3 text-gray-500">{u.email}</td>
                <td className="px-4 py-3"><span className="badge bg-gray-100 text-gray-700">{u.role}</span></td>
                <td className="px-4 py-3">{u.is_active ? 'âœ…' : 'â›”'}</td>
                <td className="px-4 py-3">
                  <button className="p-1 text-red-500 hover:bg-red-50 rounded" onClick={() => setDeleteTarget(u)}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-500">Nessun utente</td></tr>}
          </tbody>
        </table>
        <div className="p-4"><Pagination page={page} limit={20} total={total} onChange={setPage} /></div>
      </div>

      {showCreate && (
        <Modal title="Nuovo Utente" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">Username *</label>
                <input className="input" required value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} /></div>
              <div><label className="block text-sm font-medium mb-1">Nome visualizzato *</label>
                <input className="input" required value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} /></div>
            </div>
            <div><label className="block text-sm font-medium mb-1">Email *</label>
              <input className="input" type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">Password *</label>
              <input className="input" type="password" required value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">Ruolo</label>
              <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select></div>
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
    </div>
  )
}

// â”€â”€â”€ Tab Gruppi Locali â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function GroupsTab() {
  const [groups, setGroups] = useState([])
  const [selected, setSelected] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [memberInput, setMemberInput] = useState('')

  const load = () => groupsApi.list().then(r => setGroups(r.data))
  const loadDetail = (id) => groupsApi.get(id).then(r => setSelected(r.data))
  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    try { await groupsApi.create(form); toast.success('Gruppo creato'); setShowCreate(false); setForm({ name: '', description: '' }); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const handleDelete = async () => {
    try { await groupsApi.delete(deleteTarget.id); toast.success('Eliminato'); setDeleteTarget(null); if (selected?.id === deleteTarget.id) setSelected(null); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const handleAddMember = async (e) => {
    e.preventDefault()
    try { await groupsApi.addMember(selected.id, { user_id: memberInput }); toast.success('Membro aggiunto'); setMemberInput(''); loadDetail(selected.id) }
    catch (err) { toast.error(err.response?.data?.error || 'ID utente non valido') }
  }

  const handleRemoveMember = async (userId) => {
    try { await groupsApi.removeMember(selected.id, userId); loadDetail(selected.id) }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Groups list */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="font-semibold text-sm text-gray-600">Gruppi</span>
          <button className="btn-primary text-xs" onClick={() => setShowCreate(true)}><Plus size={13} />Nuovo</button>
        </div>
        {groups.map(g => (
          <button key={g.id} onClick={() => loadDetail(g.id)}
            className={`w-full text-left p-3 rounded-lg border transition-colors flex items-center gap-2 ${selected?.id === g.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
            <UsersIcon size={16} className="text-gray-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{g.name}</p>
              {g.description && <p className="text-xs text-gray-500 truncate">{g.description}</p>}
            </div>
            <ChevronRight size={14} className="text-gray-300" />
          </button>
        ))}
        {groups.length === 0 && <p className="text-sm text-gray-500 text-center py-4">Nessun gruppo</p>}
      </div>

      {/* Detail */}
      <div className="md:col-span-2">
        {selected ? (
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-lg">{selected.name}</h3>
                {selected.description && <p className="text-sm text-gray-500">{selected.description}</p>}
              </div>
              <button className="p-2 text-red-500 hover:bg-red-50 rounded" onClick={() => setDeleteTarget(selected)}><Trash2 size={16} /></button>
            </div>

            <form onSubmit={handleAddMember} className="flex gap-2">
              <input className="input flex-1 text-sm" placeholder="ID utente da aggiungere" value={memberInput} onChange={e => setMemberInput(e.target.value)} />
              <button type="submit" className="btn-primary text-xs"><Plus size={13} />Aggiungi</button>
            </form>

            <div>
              <p className="text-sm font-semibold mb-2">Membri ({selected.members?.length || 0})</p>
              <div className="space-y-1">
                {(selected.members || []).map(m => (
                  <div key={m.user_id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-sm">
                    <span>{m.username || m.user_id}</span>
                    <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => handleRemoveMember(m.user_id)}>Rimuovi</button>
                  </div>
                ))}
                {(!selected.members || selected.members.length === 0) && <p className="text-sm text-gray-400">Nessun membro</p>}
              </div>
            </div>

            {selected.ldapMappings && selected.ldapMappings.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2">Mappature LDAP</p>
                {selected.ldapMappings.map((m, i) => (
                  <div key={i} className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-xs font-mono">{m.ldap_group_dn}</div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="card p-8 flex items-center justify-center text-gray-400">
            <p className="text-sm">Seleziona un gruppo</p>
          </div>
        )}
      </div>

      {showCreate && (
        <Modal title="Nuovo Gruppo" onClose={() => setShowCreate(false)} size="sm">
          <form onSubmit={handleCreate} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Nome *</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">Descrizione</label><input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Annulla</button>
              <button type="submit" className="btn-primary">Crea</button>
            </div>
          </form>
        </Modal>
      )}
      {deleteTarget && <ConfirmDialog title="Elimina Gruppo" message={`Eliminare "${deleteTarget.name}"?`} danger confirmLabel="Elimina" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />}
    </div>
  )
}

// â”€â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function Users() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'users'

  return (
    <Layout title="Utenti & Gruppi">
      <div className="max-w-5xl space-y-6">
        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <nav className="flex gap-1 -mb-px">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setSearchParams({ tab: t.id })}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {tab === 'users' && <UsersTab />}
        {tab === 'groups' && <GroupsTab />}
      </div>
    </Layout>
  )
}

