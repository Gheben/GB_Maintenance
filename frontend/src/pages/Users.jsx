import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { usersApi, groupsApi } from '../api'
import { Pagination } from '../components/Pagination'
import { Modal, ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { Plus, Trash2, Users as UsersIcon, ChevronRight, X, User, Shield, CheckCircle, XCircle, Pencil } from 'lucide-react'

const ROLES = ['admin','change_manager','operator','viewer','subscriber']
const TABS = [
  { id: 'users', label: 'Utenti' },
  { id: 'groups', label: 'Gruppi Locali' },
]

const ALL_PERMS = [
  { key: 'dashboard',     label: 'Dashboard' },
  { key: 'assets',        label: 'Asset' },
  { key: 'services',      label: 'Servizi' },
  { key: 'maintenance',   label: 'Manutenzioni' },
  { key: 'incidents',     label: 'Incidenti' },
  { key: 'calendar',      label: 'Calendario' },
  { key: 'status_page',   label: 'Status Page' },
  { key: 'notifications', label: 'Notifiche' },
  { key: 'reports',       label: 'Report' },
  { key: 'users',         label: 'Utenti & Gruppi' },
  { key: 'settings',      label: 'Impostazioni' },
  { key: 'apikeys',       label: 'API Keys' },
  { key: 'audit',         label: 'Audit Log' },
]

function AuthBadge({ authType }) {
  if (authType === 'ldap') return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">LDAP</span>
  return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">Local</span>
}

function RoleBadge({ role }) {
  const colors = {
    superadmin: 'bg-purple-100 text-purple-700',
    admin: 'bg-blue-100 text-blue-700',
    change_manager: 'bg-indigo-100 text-indigo-700',
    operator: 'bg-green-100 text-green-700',
    viewer: 'bg-gray-100 text-gray-600',
    subscriber: 'bg-yellow-100 text-yellow-700',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${colors[role] || 'bg-gray-100 text-gray-600'}`}>{role}</span>
}

function PermissionsEditor({ value, onChange, disabled }) {
  return (
    <div className="grid grid-cols-2 gap-2 mt-2">
      {ALL_PERMS.map(p => (
        <label key={p.key} className={`flex items-center gap-2 text-sm cursor-pointer select-none ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
          <input
            type="checkbox"
            checked={!!value[p.key]}
            onChange={() => onChange({ ...value, [p.key]: !value[p.key] })}
            className="accent-blue-600"
          />
          {p.label}
        </label>
      ))}
    </div>
  )
}

function UserDetailModal({ user: u, onClose, onEdit }) {
  const hasFullAccess = u.role === 'admin' || u.role === 'superadmin'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 dark:bg-gray-700/50">
          <div className="flex items-center gap-2">
            {u.role === 'superadmin' ? <Shield size={16} className="text-purple-500" /> : <User size={16} className="text-gray-400" />}
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">{u.username}</h2>
            {u.display_name && u.display_name !== u.username && <span className="text-sm text-gray-400">{u.display_name}</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <RoleBadge role={u.role} />
            <AuthBadge authType={u.auth_type} />
            {u.is_active
              ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">Attivo</span>
              : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-400 border border-gray-200 font-medium">Disattivato</span>
            }
          </div>
          {u.email && <p className="text-sm text-gray-500">{u.email}</p>}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Permessi</p>
            {hasFullAccess ? (
              <div className="flex items-center gap-2 text-sm text-green-700 font-medium">
                <CheckCircle size={15} className="text-green-500" />
                Accesso completo a tutte le sezioni
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-4">
                {ALL_PERMS.map(p => {
                  const granted = !!u.permissions?.[p.key]
                  return (
                    <div key={p.key} className="flex items-center gap-1.5 text-xs">
                      {granted
                        ? <CheckCircle size={13} className="text-green-500 flex-shrink-0" />
                        : <XCircle size={13} className="text-red-400 flex-shrink-0" />}
                      <span className={granted ? 'text-gray-800 dark:text-gray-200 font-medium' : 'text-gray-400'}>{p.label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50 dark:bg-gray-700/50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Chiudi</button>
          {u.role !== 'superadmin' && u.auth_type !== 'ldap' && onEdit && (
            <button onClick={() => { onClose(); onEdit(u) }}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">
              Modifica permessi
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function EditPermissionsModal({ user: u, onClose, onSaved }) {
  const [role, setRole] = useState(u.role)
  const [permissions, setPermissions] = useState(u.permissions || {})
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await usersApi.update(u.id, { role, permissions: (role === 'admin' || role === 'superadmin') ? {} : permissions })
      toast.success('Permessi aggiornati')
      onSaved()
      onClose()
    } catch (err) { toast.error(err.response?.data?.error || 'Errore') }
    finally { setSaving(false) }
  }

  return (
    <Modal title={`Permessi: ${u.username}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Ruolo</label>
          <select className="input" value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Permessi {(role === 'admin' || role === 'superadmin') && <span className="text-gray-400 font-normal ml-1">(accesso completo)</span>}
          </label>
          <PermissionsEditor value={permissions} onChange={setPermissions} disabled={role === 'admin' || role === 'superadmin'} />
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Annulla</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Salvataggio...' : 'Salva'}</button>
        </div>
      </form>
    </Modal>
  )
}

// â”€â”€â”€ Tab Utenti â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function UsersTab() {
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [authFilter, setAuthFilter] = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [detail, setDetail] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState({ username: '', display_name: '', email: '', password: '', role: 'operator', permissions: {} })

  const load = () => usersApi.list({ page, limit: 20 }).then(r => {
    const list = Array.isArray(r.data) ? r.data : (r.data.data || [])
    const tot  = Array.isArray(r.data) ? r.data.length : (r.data.total || r.data.length || 0)
    setUsers(list); setTotal(tot)
  })
  useEffect(() => { load() }, [page])

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      const payload = { ...form }
      if (form.role === 'admin') payload.permissions = {}
      await usersApi.create(payload); toast.success('Utente creato'); setShowCreate(false)
      setForm({ username: '', display_name: '', email: '', password: '', role: 'operator', permissions: {} }); load()
    }
    catch (err) { toast.error(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Errore') }
  }

  const handleDelete = async () => {
    try { await usersApi.delete(deleteTarget.id); toast.success('Utente eliminato'); setDeleteTarget(null); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const filtered = authFilter === 'all' ? users : users.filter(u => u.auth_type === authFilter)
  const hasFullAccess = (u) => u.role === 'admin' || u.role === 'superadmin'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Tipo:</span>
          {['all','local','ldap'].map(f => (
            <button key={f} onClick={() => setAuthFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${authFilter === f ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {f === 'all' ? 'Tutti' : f.toUpperCase()}
            </button>
          ))}
          {authFilter !== 'all' && <span className="text-xs text-gray-400">({filtered.length} mostrati)</span>}
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />Nuovo Utente</button>
      </div>

      <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="min-w-[640px] w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>{['Username','Nome','Email','Auth','Ruolo','Permessi','Azioni'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map(u => (
              <tr key={u.id}
                className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer select-none"
                onDoubleClick={() => setDetail(u)}
                title="Doppio click per i dettagli">
                <td className="px-4 py-3 font-mono text-xs">
                  <div className="flex items-center gap-1.5">
                    {u.role === 'superadmin' ? <Shield size={13} className="text-purple-500" /> : <User size={13} className="text-gray-400" />}
                    {u.username}
                  </div>
                </td>
                <td className="px-4 py-3">{u.display_name}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                <td className="px-4 py-3"><AuthBadge authType={u.auth_type} /></td>
                <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px]">
                  {hasFullAccess(u)
                    ? <span className="italic text-green-600">Accesso completo</span>
                    : ALL_PERMS.filter(p => u.permissions?.[p.key]).map(p => p.label).join(', ') ||
                      <span className="italic text-gray-400">Nessun permesso</span>
                  }
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    {u.role !== 'superadmin' && u.auth_type !== 'ldap' && (
                      <button className="p-1 text-gray-400 hover:text-blue-600 rounded" onClick={e => { e.stopPropagation(); setEditTarget(u) }} title="Modifica permessi"><Pencil size={14} /></button>
                    )}
                    <button className="p-1 text-red-500 hover:bg-red-50 rounded" onClick={e => { e.stopPropagation(); setDeleteTarget(u) }}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-500">Nessun utente</td></tr>}
          </tbody>
        </table>
        </div>
        <div className="p-4"><Pagination page={page} limit={20} total={total} onChange={setPage} /></div>
      </div>

      {detail && (
        <UserDetailModal user={detail} onClose={() => setDetail(null)} onEdit={u => { setDetail(null); setEditTarget(u) }} />
      )}

      {editTarget && (
        <EditPermissionsModal user={editTarget} onClose={() => setEditTarget(null)} onSaved={load} />
      )}

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
            <div>
              <label className="block text-sm font-medium mb-1">
                Permessi {form.role === 'admin' && <span className="text-gray-400 font-normal ml-1">(accesso completo per admin)</span>}
              </label>
              <PermissionsEditor value={form.permissions} onChange={p => setForm(f => ({ ...f, permissions: p }))} disabled={form.role === 'admin'} />
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
    </div>
  )
}

// â”€â”€â”€ Tab Gruppi Locali â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function GroupsTab() {
  const [groups, setGroups] = useState([])
  const [selected, setSelected] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', permissions: {} })
  const [memberInput, setMemberInput] = useState('')
  const [editPerms, setEditPerms] = useState(false)
  const [editPermsData, setEditPermsData] = useState({})

  const load = () => groupsApi.list().then(r => setGroups(r.data))
  const loadDetail = (id) => groupsApi.get(id).then(r => setSelected(r.data))
  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    try { await groupsApi.create(form); toast.success('Gruppo creato'); setShowCreate(false); setForm({ name: '', description: '', permissions: {} }); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const handleDelete = async () => {
    try { await groupsApi.delete(deleteTarget.id); toast.success('Eliminato'); setDeleteTarget(null); if (selected?.id === deleteTarget.id) setSelected(null); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const handleAddMember = async (e) => {
    e.preventDefault()
    try { await groupsApi.addMember(selected.id, memberInput); toast.success('Membro aggiunto'); setMemberInput(''); loadDetail(selected.id) }
    catch (err) { toast.error(err.response?.data?.error || 'ID utente non valido') }
  }

  const handleRemoveMember = async (userId) => {
    try { await groupsApi.removeMember(selected.id, userId); loadDetail(selected.id) }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const handleSaveGroupPerms = async () => {
    try { await groupsApi.update(selected.id, { permissions: editPermsData }); toast.success('Permessi gruppo aggiornati'); setEditPerms(false); loadDetail(selected.id) }
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

            {/* Permissions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">Permessi</p>
                {!editPerms ? (
                  <button className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                    onClick={() => { setEditPermsData(selected.permissions || {}); setEditPerms(true) }}>
                    <Pencil size={12} />Modifica
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button className="text-xs text-green-600 hover:underline" onClick={handleSaveGroupPerms}>Salva</button>
                    <button className="text-xs text-gray-400 hover:underline" onClick={() => setEditPerms(false)}>Annulla</button>
                  </div>
                )}
              </div>
              {editPerms ? (
                <PermissionsEditor value={editPermsData} onChange={setEditPermsData} disabled={false} />
              ) : (
                <div className="grid grid-cols-2 gap-y-1 gap-x-4">
                  {ALL_PERMS.map(p => {
                    const granted = !!(selected.permissions || {})[p.key]
                    return (
                      <div key={p.key} className="flex items-center gap-1.5 text-xs">
                        {granted
                          ? <CheckCircle size={12} className="text-green-500 flex-shrink-0" />
                          : <XCircle size={12} className="text-red-300 flex-shrink-0" />}
                        <span className={granted ? 'text-gray-700 font-medium' : 'text-gray-400'}>{p.label}</span>
                      </div>
                    )
                  })}
                </div>
              )}
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
            <div>
              <label className="block text-sm font-medium mb-1">Permessi</label>
              <PermissionsEditor value={form.permissions} onChange={p => setForm(f => ({ ...f, permissions: p }))} disabled={false} />
            </div>
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

