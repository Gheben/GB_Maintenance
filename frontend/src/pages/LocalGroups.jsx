import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { groupsApi } from '../api'
import { Modal, ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { Plus, Trash2, Users, ChevronRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function LocalGroups() {
  const { hasRole } = useAuth()
  const canBulkDelete = hasRole('superadmin', 'admin')
  const [groups, setGroups] = useState([])
  const [selected, setSelected] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [selectedGroupIds, setSelectedGroupIds] = useState([])
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [memberEmail, setMemberEmail] = useState('')

  const load = () => groupsApi.list().then(r => setGroups(r.data))
  const loadDetail = (id) => groupsApi.get(id).then(r => setSelected(r.data))

  useEffect(() => { load() }, [])
  useEffect(() => {
    setSelectedGroupIds(prev => prev.filter(id => groups.some(g => g.id === id)))
  }, [groups])

  const handleCreate = async (e) => {
    e.preventDefault()
    try { await groupsApi.create(form); toast.success('Gruppo creato'); setShowCreate(false); setForm({ name: '', description: '' }); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const handleDelete = async () => {
    try { await groupsApi.delete(deleteTarget.id); toast.success('Eliminato'); setDeleteTarget(null); if (selected?.id === deleteTarget.id) setSelected(null); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const toggleGroupSelection = (id) => {
    if (!canBulkDelete) return
    setSelectedGroupIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleSelectAllGroups = (checked) => {
    if (!canBulkDelete) return
    if (checked) {
      setSelectedGroupIds(groups.map(g => g.id))
      return
    }
    setSelectedGroupIds([])
  }

  const allGroupsSelected = groups.length > 0 && groups.every(g => selectedGroupIds.includes(g.id))

  const handleBulkDeleteGroups = async () => {
    if (!canBulkDelete || selectedGroupIds.length === 0) return
    setBulkDeleting(true)
    try {
      const results = await Promise.allSettled(selectedGroupIds.map((id) => groupsApi.delete(id)))
      const ok = results.filter(r => r.status === 'fulfilled').length
      const ko = results.length - ok
      if (ok > 0) toast.success(`${ok} gruppo/i eliminato/i`)
      if (ko > 0) toast.error(`${ko} gruppo/i non eliminato/i`)
      if (selected?.id && selectedGroupIds.includes(selected.id)) setSelected(null)
      setSelectedGroupIds([])
      setBulkDeleteConfirm(false)
      await load()
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleAddMember = async (e) => {
    e.preventDefault()
    // groupsApi.addMember expects { user_id } — for simplicity we show a user_id input
    try { await groupsApi.addMember(selected.id, { user_id: memberEmail }); toast.success('Membro aggiunto'); setMemberEmail(''); loadDetail(selected.id) }
    catch (err) { toast.error(err.response?.data?.error || 'ID utente non valido') }
  }

  const handleRemoveMember = async (userId) => {
    try { await groupsApi.removeMember(selected.id, userId); loadDetail(selected.id) }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  return (
    <Layout title="Gruppi Locali">
      <div className="max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Groups list */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-sm text-gray-600">Gruppi</span>
            <div className="flex items-center gap-2">
              {canBulkDelete && (
                <button
                  className="btn-danger text-xs"
                  disabled={selectedGroupIds.length === 0 || bulkDeleting}
                  onClick={() => setBulkDeleteConfirm(true)}
                >
                  <Trash2 size={13} />Elimina selezionati ({selectedGroupIds.length})
                </button>
              )}
              <button className="btn-primary text-xs" onClick={() => setShowCreate(true)}><Plus size={13} />Nuovo</button>
            </div>
          </div>
          {canBulkDelete && groups.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <input
                type="checkbox"
                checked={allGroupsSelected}
                onChange={(e) => toggleSelectAllGroups(e.target.checked)}
                aria-label="Seleziona tutti i gruppi"
              />
              Seleziona tutti
            </label>
          )}
          {groups.map(g => (
            <div key={g.id} className="flex items-stretch gap-2">
              {canBulkDelete && (
                <label className="flex items-center px-2 border border-gray-200 dark:border-gray-700 rounded-lg">
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(g.id)}
                    onChange={() => toggleGroupSelection(g.id)}
                    aria-label={`Seleziona gruppo ${g.name}`}
                  />
                </label>
              )}
              <button onClick={() => loadDetail(g.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors flex items-center gap-2 ${selected?.id === g.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                <Users size={16} className="text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{g.name}</p>
                  {g.description && <p className="text-xs text-gray-500 truncate">{g.description}</p>}
                </div>
                <ChevronRight size={14} className="text-gray-300" />
              </button>
            </div>
          ))}
          {groups.length === 0 && <p className="text-sm text-gray-500 text-center py-4">Nessun gruppo</p>}
        </div>

        {/* Group detail */}
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

              {/* Add member */}
              <form onSubmit={handleAddMember} className="flex gap-2">
                <input className="input flex-1 text-sm" placeholder="ID utente da aggiungere" value={memberEmail} onChange={e => setMemberEmail(e.target.value)} />
                <button type="submit" className="btn-primary text-xs"><Plus size={13} />Aggiungi</button>
              </form>

              {/* Members */}
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

              {/* LDAP mappings */}
              {selected.ldapMappings && selected.ldapMappings.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2">Mappature LDAP</p>
                  <div className="space-y-1">
                    {selected.ldapMappings.map((m, i) => (
                      <div key={i} className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-xs font-mono">{m.ldap_group_dn}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="card p-8 flex items-center justify-center text-gray-400">
              <p className="text-sm">Seleziona un gruppo</p>
            </div>
          )}
        </div>
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
      {bulkDeleteConfirm && (
        <ConfirmDialog
          title="Elimina gruppi selezionati"
          message={`Eliminare ${selectedGroupIds.length} gruppo/i selezionato/i? L'operazione non puo essere annullata.`}
          danger
          confirmLabel={bulkDeleting ? 'Eliminazione...' : 'Elimina'}
          onConfirm={handleBulkDeleteGroups}
          onCancel={() => !bulkDeleting && setBulkDeleteConfirm(false)}
        />
      )}
    </Layout>
  )
}
