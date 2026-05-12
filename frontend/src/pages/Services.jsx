import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { servicesApi, usersApi, groupsApi, settingsApi } from '../api'
import { Plus, Search, RefreshCw, Users, User, Database, Pencil } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const BLANK_FORM = { name: '', description: '', criticality: 'medium', sla_uptime_percent: 99.9, is_public: false, owner_type: 'user', owner_id: '', owner_group_id: '', owner_ldap_dn: '', owner_ldap_name: '', system_name: '' }

export default function Services() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('services')
  const [services, setServices] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [users, setUsers] = useState([])
  const [localGroups, setLocalGroups] = useState([])
  const [ldapEnabled, setLdapEnabled] = useState(false)
  const [ldapSearch, setLdapSearch] = useState('')
  const [ldapResults, setLdapResults] = useState([])
  const [ldapLoading, setLdapLoading] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)

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
    groupsApi.list().then(r => setLocalGroups(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    settingsApi.getLdap().then(r => setLdapEnabled(!!(r.data?.enabled))).catch(() => {})
  }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    const payload = {
      ...form,
      owner_id: form.owner_type === 'user' ? (form.owner_id || undefined) : undefined,
      owner_group_id: form.owner_type === 'local_group' ? (form.owner_group_id || undefined) : undefined,
      owner_ldap_dn: form.owner_type === 'ldap_group' ? (form.owner_ldap_dn || undefined) : undefined,
      owner_ldap_name: form.owner_type === 'ldap_group' ? (form.owner_ldap_name || undefined) : undefined,
      system_name: form.system_name || undefined,
    }
    try {
      await servicesApi.create(payload)
      toast.success('Service created')
      setShowCreate(false)
      setForm(BLANK_FORM)
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const openEdit = (s) => {
    setEditTarget(s)
    setForm({
      name: s.name, description: s.description || '', criticality: s.criticality,
      sla_uptime_percent: s.sla_uptime_percent, is_public: s.is_public,
      owner_type: s.owner_type || 'user', owner_id: s.owner_id || '',
      owner_group_id: s.owner_group_id || '', owner_ldap_dn: s.owner_ldap_dn || '',
      owner_ldap_name: s.owner_ldap_name || '', system_name: s.system_name || ''
    })
  }

  const handleEdit = async (e) => {
    e.preventDefault()
    const payload = {
      ...form,
      owner_id: form.owner_type === 'user' ? (form.owner_id || undefined) : undefined,
      owner_group_id: form.owner_type === 'local_group' ? (form.owner_group_id || undefined) : undefined,
      owner_ldap_dn: form.owner_type === 'ldap_group' ? (form.owner_ldap_dn || undefined) : undefined,
      owner_ldap_name: form.owner_type === 'ldap_group' ? (form.owner_ldap_name || undefined) : undefined,
      system_name: form.system_name || undefined,
    }
    try {
      await servicesApi.update(editTarget.id, payload)
      toast.success('Service updated')
      setEditTarget(null)
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const handleLdapSearch = async (q) => {
    setLdapSearch(q)
    if (!q || q.length < 2) { setLdapResults([]); return }
    setLdapLoading(true)
    try {
      const r = await settingsApi.searchLdapGroups(q)
      setLdapResults(r.data || [])
    } catch { setLdapResults([]) }
    finally { setLdapLoading(false) }
  }

  const OwnerFields = ({ formState, setFormState }) => (
    <div>
      <label className="block text-sm font-medium mb-1">Owner</label>
      <div className="flex gap-1 mb-2">
        {[
          { key: 'user', label: 'User', icon: <User size={11} /> },
          { key: 'local_group', label: 'Local group', icon: <Users size={11} /> },
          ...(ldapEnabled ? [{ key: 'ldap_group', label: 'LDAP group', icon: <Database size={11} /> }] : []),
        ].map(t => (
          <button key={t.key} type="button"
            onClick={() => setFormState(f => ({ ...f, owner_type: t.key, owner_id: '', owner_group_id: '', owner_ldap_dn: '', owner_ldap_name: '' }))}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${formState.owner_type === t.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-600 hover:border-brand-400'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>
      {formState.owner_type === 'user' && (
        <select className="input" value={formState.owner_id} onChange={e => setFormState(f => ({ ...f, owner_id: e.target.value }))}>
          <option value="">— None —</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username} ({u.auth_type || 'local'})</option>)}
        </select>
      )}
      {formState.owner_type === 'local_group' && (
        <select className="input" value={formState.owner_group_id} onChange={e => setFormState(f => ({ ...f, owner_group_id: e.target.value }))}>
          <option value="">— No group —</option>
          {localGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      )}
      {formState.owner_type === 'ldap_group' && (
        <div className="relative">
          <input className="input" placeholder="Search LDAP group (min 2 chars)..."
            value={formState.owner_ldap_dn ? formState.owner_ldap_name : ldapSearch}
            onChange={e => {
              if (formState.owner_ldap_dn) setFormState(f => ({ ...f, owner_ldap_dn: '', owner_ldap_name: '' }))
              handleLdapSearch(e.target.value)
            }} />
          {formState.owner_ldap_dn && <span className="absolute right-2 top-2 text-xs text-green-600 font-medium">✓ selected</span>}
          {ldapLoading && <p className="text-xs text-gray-400 mt-1">Searching...</p>}
          {ldapResults.length > 0 && !formState.owner_ldap_dn && (
            <div className="absolute z-10 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
              {ldapResults.map(g => (
                <button key={g.dn} type="button"
                  onClick={() => { setFormState(f => ({ ...f, owner_ldap_dn: g.dn, owner_ldap_name: g.name })); setLdapResults([]) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 dark:hover:bg-gray-700">
                  <span className="font-medium">{g.name}</span>
                  {g.description && <span className="text-xs text-gray-400 ml-2">{g.description}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )

  const ServiceForm = ({ onSubmit, onClose, submitLabel }) => (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Name *</label>
        <input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">System / Group</label>
          <input className="input" placeholder="e.g. ERP, Network, Cloud" value={form.system_name} onChange={e => setForm(f => ({ ...f, system_name: e.target.value }))} />
        </div>
        <OwnerFields formState={form} setFormState={setForm} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Criticality</label>
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
        <label htmlFor="public" className="text-sm">Visible on public status page</label>
      </div>
      <div className="flex justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary">{submitLabel}</button>
      </div>
    </form>
  )

  return (
    <Layout title="Services">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
            <input className="input pl-9 w-48" placeholder="Search..." value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }} />
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={load}><RefreshCw size={15} /></button>
            {canEdit && <button className="btn-primary" onClick={() => { setForm(BLANK_FORM); setShowCreate(true) }}><Plus size={15} />New Service</button>}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[640px] w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>{['Name','System','Criticality','Status','Owner','Assets','SLA %','Public',''].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading ? <tr><td colSpan={9} className="text-center py-8 text-gray-500">Loading...</td></tr>
                  : services.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 font-medium">
                        <Link to={`/services/${s.id}`} className="text-brand-600 hover:underline">{s.name}</Link>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{s.system_name ? <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 font-medium">{s.system_name}</span> : '—'}</td>
                      <td className="px-4 py-3"><CriticalityBadge criticality={s.criticality} /></td>
                      <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                      <td className="px-4 py-3 text-sm text-gray-600">{s.owner_label || s.owner_name || <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-500">{s.asset_count ?? 0}</td>
                      <td className="px-4 py-3 text-gray-500">{s.sla_uptime_percent}%</td>
                      <td className="px-4 py-3">{s.is_public ? '✅' : '—'}</td>
                      <td className="px-4 py-3">
                        {canEdit && (
                          <button onClick={() => openEdit(s)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-400 hover:text-brand-600 transition-colors">
                            <Pencil size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="p-4"><Pagination page={page} limit={20} total={total} onChange={setPage} /></div>
        </div>
      </div>

      {showCreate && (
        <Modal title="New Service" onClose={() => setShowCreate(false)}>
          <ServiceForm onSubmit={handleCreate} onClose={() => setShowCreate(false)} submitLabel="Create" />
        </Modal>
      )}
    </Layout>
  )
}
