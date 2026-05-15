import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { servicesApi, usersApi, groupsApi, settingsApi } from '../api'
import { format } from 'date-fns'
import { Trash2, ArrowLeft, Pencil, Save, X, Plus, ExternalLink, User, Users, Mail, Cog } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const CRITICALITIES = ['critical','high','medium','low']
const TABS = [['info','Info'],['deps','Dependencies'],['assets','Linked Assets'],['licenses','Licenses'],['maintenance','Maintenance'],['users','Users']]

export default function ServiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const [service, setService] = useState(null)
  const [maintenance, setMaintenance] = useState([])
  const [allServices, setAllServices] = useState([])
  const [tab, setTab] = useState('info')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [depSearch, setDepSearch] = useState('')
  const [addingDep, setAddingDep] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [userLimit, setUserLimit] = useState(25)
  
  // Owner states
  const [ownerUsers, setOwnerUsers] = useState([])
  const [ownerUserSearch, setOwnerUserSearch] = useState('')
  const [ownerUserResults, setOwnerUserResults] = useState([])
  const [ownerUserSearching, setOwnerUserSearching] = useState(false)
  const [localGroups, setLocalGroups] = useState([])
  const [ldapEnabled, setLdapEnabled] = useState(false)
  const [groupSearch, setGroupSearch] = useState('')
  const [groupResults, setGroupResults] = useState([])
  const [groupLoading, setGroupLoading] = useState(false)
  const [licenseRows, setLicenseRows] = useState([])
  const [savingLicenses, setSavingLicenses] = useState(false)

  const load = () => {
    servicesApi.get(id).then(r => setService(r.data)).catch(() => navigate('/services'))
    servicesApi.maintenance(id).then(r => setMaintenance(r.data)).catch(() => {})
  }

  useEffect(() => { load() }, [id])

  useEffect(() => {
    if (tab === 'deps') {
      servicesApi.list({ limit: 200 }).then(r => {
        const list = Array.isArray(r.data) ? r.data : (r.data.data || [])
        setAllServices(list.filter(s => s.id !== id))
      }).catch(() => {})
    }
    if (tab === 'licenses') {
      servicesApi.licenses(id).then(r => setLicenseRows(Array.isArray(r.data) ? r.data : [])).catch(() => setLicenseRows([]))
    }
  }, [tab, id])

  const loadOwnerData = () => {
    usersApi.list({ limit: 500 }).then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data.data || [])
      setOwnerUsers(list.filter(u => u.is_active !== false))
    }).catch(() => {})
    groupsApi.list().then(r => setLocalGroups(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    settingsApi.getLdap().then(r => setLdapEnabled(r.data?.enabled || false)).catch(() => {})
  }

  const handleGroupSearch = async (q) => {
    setGroupSearch(q)
    if (!q || q.length < 1) { setGroupResults([]); return }

    const localMatches = localGroups
      .filter(g => String(g.name || '').toLowerCase().includes(q.toLowerCase()))
      .slice(0, 20)
      .map(g => ({ key: `local:${g.id}`, type: 'local_group', label: g.name, id: g.id }))

    if (!ldapEnabled) {
      setGroupResults(localMatches)
      return
    }

    setGroupLoading(true)
    try {
      const r = await settingsApi.searchLdapGroups(q)
      const ldapMatches = (r.data || []).map(g => ({
        key: `ldap:${g.dn}`,
        type: 'ldap_group',
        label: g.name,
        description: g.description,
        dn: g.dn,
      }))
      setGroupResults([...localMatches, ...ldapMatches])
    } catch {
      setGroupResults(localMatches)
    } finally {
      setGroupLoading(false)
    }
  }

  const handleOwnerUserSearch = async (q) => {
    setOwnerUserSearch(q)
    const qq = String(q || '').trim().toLowerCase()
    if (qq.length < 1) { setOwnerUserResults([]); return }

    const localMatches =
      ownerUsers
        .filter(u =>
          String(u.display_name || u.username || '').toLowerCase().includes(qq) ||
          String(u.username || '').toLowerCase().includes(qq) ||
          String(u.email || '').toLowerCase().includes(qq)
        )
        .slice(0, 25)
        .map(u => ({ key: `local:${u.id}`, type: 'local_user', id: u.id, name: u.display_name || u.username, email: u.email }))

    if (!ldapEnabled) {
      setOwnerUserResults(localMatches)
      return
    }

    setOwnerUserSearching(true)
    try {
      const r = await settingsApi.searchLdapUsers(q)
      const ldapMatches = (r.data || []).map(u => ({
        key: `ldap:${u.dn}`,
        type: 'ldap_user',
        dn: u.dn,
        name: u.name || u.username || u.email,
        email: u.email,
      }))
      setOwnerUserResults([...localMatches, ...ldapMatches])
    } catch {
      setOwnerUserResults(localMatches)
    } finally {
      setOwnerUserSearching(false)
    }
  }

  const saveLicenses = async () => {
    setSavingLicenses(true)
    try {
      const selected = licenseRows.filter(l => l.assigned).map(l => l.id)
      await servicesApi.updateLicenses(id, selected)
      toast.success('Licenses updated')
      const r = await servicesApi.licenses(id)
      setLicenseRows(Array.isArray(r.data) ? r.data : [])
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error updating licenses')
    } finally {
      setSavingLicenses(false)
    }
  }

  const handleDelete = async () => {
    try { await servicesApi.delete(id); toast.success('Service deleted'); navigate('/services') }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const enterEdit = () => {
    if (!service) return
    loadOwnerData()
    setEditForm({
      name: service.name || '',
      description: service.description || '',
      criticality: service.criticality || 'medium',
      sla_target: service.sla_target || service.sla_uptime_percent || '',
      system_name: service.system_name || '',
      owner_type: service.owner_type || 'user',
      owner_id: service.owner_id || '',
      owner_group_id: service.owner_group_id || '',
      owner_ldap_dn: service.owner_ldap_dn || '',
      owner_ldap_name: service.owner_ldap_name || '',
    })
    setGroupResults([])
    setGroupSearch('')
    setEditMode(true)
    setTab('info')
  }

  const cancelEdit = () => { setEditMode(false); setEditForm(null) }

  const saveEdit = async () => {
    if (!editForm.name.trim()) { toast.error('Name is required'); return }

    setSaving(true)
    try {
      await servicesApi.update(id, {
        name: editForm.name,
        description: editForm.description || null,
        criticality: editForm.criticality,
        sla_uptime_percent: editForm.sla_target ? parseFloat(editForm.sla_target) : undefined,
        system_name: editForm.system_name || null,
        owner_type: editForm.owner_type,
        owner_id: editForm.owner_type === 'user' ? (editForm.owner_id || null) : null,
        owner_group_id: editForm.owner_type === 'local_group' ? (editForm.owner_group_id || null) : null,
        owner_ldap_dn: ['ldap_user', 'ldap_group'].includes(editForm.owner_type) ? (editForm.owner_ldap_dn || null) : null,
        owner_ldap_name: ['ldap_user', 'ldap_group'].includes(editForm.owner_type) ? (editForm.owner_ldap_name || null) : null,
      })
      toast.success('Service updated')
      setEditMode(false); setEditForm(null); load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
    finally { setSaving(false) }
  }

  const addDep = async (depId) => {
    try { await servicesApi.addDependency(id, depId); toast.success('Dependency added'); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }
  const removeDep = async (depId) => {
    try { await servicesApi.removeDependency(id, depId); toast.success('Dependency removed'); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  if (!service) return <Layout title="Service"><div className="text-center py-16 text-gray-500">Loading...</div></Layout>

  const canEdit = hasRole('superadmin', 'admin')
  const existingDepIds = new Set((service.depends_on || []).map(d => d.id))
  const filteredServices = allServices.filter(s =>
    s.name.toLowerCase().includes(depSearch.toLowerCase()) && !existingDepIds.has(s.id)
  )
  const qU = userSearch.toLowerCase()
  const subs = service.subscribers || []
  const filteredSubs = subs.filter(u => !qU ||
    (u.display_name||'').toLowerCase().includes(qU) ||
    (u.username||'').toLowerCase().includes(qU) ||
    (u.email||'').toLowerCase().includes(qU))
  const visibleSubs = filteredSubs.slice(0, userLimit)

  return (
    <Layout title={service.name}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link to="/services" className="flex items-center gap-1 text-gray-500 hover:text-gray-700 text-sm"><ArrowLeft size={16} />Services</Link>
          <div className="flex gap-2">
            {!editMode && canEdit && <button className="btn-secondary flex items-center gap-1" onClick={enterEdit}><Pencil size={14} />Edit</button>}
            {editMode && <>
              <button className="btn-secondary flex items-center gap-1" onClick={cancelEdit} disabled={saving}><X size={14} />Cancel</button>
              <button className="btn-primary flex items-center gap-1" onClick={saveEdit} disabled={saving}><Save size={14} />{saving ? 'Saving...' : 'Save'}</button>
            </>}
            {!editMode && canEdit && <button className="btn-danger flex items-center gap-1" onClick={() => setDeleteConfirm(true)}><Trash2 size={14} />Delete</button>}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {TABS.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === key ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Info tab */}
        {tab === 'info' && (editMode && editForm ? (
          <div className="card p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input className="input" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Criticality</label>
                <select className="input" value={editForm.criticality} onChange={e => setEditForm(f => ({ ...f, criticality: e.target.value }))}>
                  {CRITICALITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">SLA target %</label>
                <input className="input" type="number" min="0" max="100" step="0.1" value={editForm.sla_target} onChange={e => setEditForm(f => ({ ...f, sla_target: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input" rows={3} value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">System / Group</label>
              <input className="input" value={editForm.system_name} onChange={e => setEditForm(f => ({ ...f, system_name: e.target.value }))} />
            </div>
            {/* Owner Selection */}
            <div>
              <label className="block text-sm font-medium mb-2">Owner</label>
              <div className="flex gap-1 mb-2 flex-wrap">
                {[
                  { key: 'user', label: 'User', icon: <User size={11} /> },
                  { key: 'ldap_user', label: 'AD User', icon: <User size={11} /> },
                  { key: 'local_group', label: 'Group', icon: <Users size={11} /> },
                ].map(t => (
                  <button key={t.key} type="button"
                    onClick={() => setEditForm(f => ({ ...f, owner_type: t.key, owner_id: '', owner_group_id: '', owner_ldap_dn: '', owner_ldap_name: '' }))}
                    className={`flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${editForm.owner_type === t.key ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-600 hover:border-brand-400'}`}>
                    {t.icon}{t.label}
                  </button>
                ))}
              </div>
              {(editForm.owner_type === 'user' || editForm.owner_type === 'ldap_user') && (
                <div className="relative">
                  <input
                    className="input"
                    placeholder="Search user in AD/local..."
                    value={editForm.owner_type === 'user' && editForm.owner_id
                      ? (ownerUsers.find(u => u.id === editForm.owner_id)?.display_name || ownerUsers.find(u => u.id === editForm.owner_id)?.username || '')
                      : (editForm.owner_type === 'ldap_user' && editForm.owner_ldap_dn ? (editForm.owner_ldap_name || editForm.owner_ldap_dn) : ownerUserSearch)}
                    onChange={e => {
                      if (editForm.owner_id || editForm.owner_ldap_dn) {
                        setEditForm(f => ({ ...f, owner_id: '', owner_ldap_dn: '', owner_ldap_name: '' }))
                      }
                      handleOwnerUserSearch(e.target.value)
                    }}
                  />
                  {(editForm.owner_id || editForm.owner_ldap_dn) && <span className="absolute right-2 top-2 text-xs text-green-600 font-medium">selected</span>}
                  {ownerUserResults.length > 0 && !editForm.owner_id && !editForm.owner_ldap_dn && (
                    <div className="absolute z-10 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {ownerUserResults.map(u => (
                        <button
                          key={u.key}
                          type="button"
                          onClick={() => {
                            if (u.type === 'local_user') {
                              setEditForm(f => ({ ...f, owner_type: 'user', owner_id: u.id, owner_ldap_dn: '', owner_ldap_name: '' }))
                            } else {
                              setEditForm(f => ({ ...f, owner_type: 'ldap_user', owner_id: '', owner_ldap_dn: u.dn, owner_ldap_name: u.name }))
                            }
                            setOwnerUserResults([])
                            setOwnerUserSearch('')
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 dark:hover:bg-gray-700"
                        >
                          <span className="font-medium">{u.name}</span>
                          <span className="text-xs text-gray-400 ml-2">{u.email || (u.type === 'ldap_user' ? 'LDAP' : '')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {(editForm.owner_type === 'local_group' || editForm.owner_type === 'ldap_group') && (
                <div className="relative">
                  <input className="input" placeholder="Search local/LDAP group..."
                    value={(editForm.owner_type === 'local_group' && editForm.owner_group_id) || (editForm.owner_type === 'ldap_group' && editForm.owner_ldap_dn)
                      ? (editForm.owner_type === 'local_group' ? (localGroups.find(g => g.id === editForm.owner_group_id)?.name || '') : editForm.owner_ldap_name)
                      : groupSearch}
                    onChange={e => {
                      if (editForm.owner_type !== 'user') {
                        setEditForm(f => ({ ...f, owner_type: 'local_group', owner_group_id: '', owner_ldap_dn: '', owner_ldap_name: '' }))
                      }
                      handleGroupSearch(e.target.value)
                    }} />
                  {(editForm.owner_group_id || editForm.owner_ldap_dn) && <span className="absolute right-2 top-2 text-xs text-green-600 font-medium">selected</span>}
                  {groupResults.length > 0 && !editForm.owner_group_id && !editForm.owner_ldap_dn && (
                    <div className="absolute z-10 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {groupResults.map(g => (
                        <button key={g.key} type="button"
                          onClick={() => {
                            if (g.type === 'local_group') {
                              setEditForm(f => ({ ...f, owner_type: 'local_group', owner_group_id: g.id, owner_ldap_dn: '', owner_ldap_name: '' }))
                            } else {
                              setEditForm(f => ({ ...f, owner_type: 'ldap_group', owner_group_id: '', owner_ldap_dn: g.dn, owner_ldap_name: g.label }))
                            }
                            setGroupResults([])
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 dark:hover:bg-gray-700">
                          <span className="font-medium">{g.label}</span>
                          <span className="text-xs text-gray-400 ml-2">{g.type === 'local_group' ? 'Local' : 'LDAP'}</span>
                          {g.description && <span className="text-xs text-gray-400 ml-2">{g.description}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="card p-6">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <StatusBadge status={service.current_status} />
              <CriticalityBadge criticality={service.criticality} />
              {service.system_name && <span className="badge bg-indigo-100 text-indigo-700">{service.system_name}</span>}
              {service.slug && <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{service.slug}</span>}
            </div>
            {service.description && <p className="text-gray-600 dark:text-gray-300 mb-3">{service.description}</p>}
            <div className="flex flex-wrap gap-6 text-sm text-gray-600 dark:text-gray-400">
              {(service.sla_target || service.sla_uptime_percent) && <span>SLA: <strong>{service.sla_target || service.sla_uptime_percent}%</strong></span>}
              {service.url && <a href={service.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-brand-600 hover:underline"><ExternalLink size={13} />{service.url}</a>}
            </div>
            {(service.owner_label || service.owner_name) && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <User size={14} className="text-gray-400" />
                <span className="font-medium text-gray-700 dark:text-gray-300">Owner:</span>
                <span>{service.owner_label || service.owner_name}</span>
                {service.owner_email && <a href={`mailto:${service.owner_email}`} className="flex items-center gap-1 text-brand-600 hover:underline text-xs"><Mail size={12} />{service.owner_email}</a>}
              </div>
            )}
          </div>
        ))}

        {/* Deps tab */}
        {tab === 'deps' && (
          <div className="card p-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium mb-3 text-sm">Depends on</h3>
                {(service.depends_on || []).length === 0 && <p className="text-gray-500 text-sm">No dependencies</p>}
                {(service.depends_on || []).map(s => (
                  <div key={s.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <Link to={`/services/${s.id}`} className="text-sm text-brand-600 hover:underline flex items-center gap-1.5">
                      <Cog size={13} />{s.name}
                    </Link>
                    {canEdit && <button onClick={() => removeDep(s.id)} className="text-xs text-red-400 hover:text-red-600 ml-2"><X size={13} /></button>}
                  </div>
                ))}
              </div>
              <div>
                <h3 className="font-medium mb-3 text-sm">Required by</h3>
                {(service.required_by || []).length === 0 && <p className="text-gray-500 text-sm">None</p>}
                {(service.required_by || []).map(s => (
                  <Link key={s.id} to={`/services/${s.id}`} className="block text-sm text-brand-600 hover:underline py-1">{s.name}</Link>
                ))}
              </div>
            </div>
            {canEdit && (
              <div>
                <button className="btn-secondary text-xs flex items-center gap-1 mb-3" onClick={() => setAddingDep(o => !o)}>
                  <Plus size={13} />{addingDep ? 'Cancel' : 'Add dependency'}
                </button>
                {addingDep && (
                  <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                    <div className="p-2 bg-gray-50 dark:bg-gray-700/50">
                      <input className="input py-1 text-sm" placeholder="Search service..." value={depSearch} onChange={e => setDepSearch(e.target.value)} />
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
                      {filteredServices.slice(0, 25).map(s => (
                        <button key={s.id} type="button" onClick={() => { addDep(s.id); setAddingDep(false); setDepSearch('') }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 dark:hover:bg-brand-900/20 flex items-center justify-between">
                          <span>{s.name}</span>
                          <StatusBadge status={s.current_status} />
                        </button>
                      ))}
                      {filteredServices.length === 0 && <p className="text-center py-4 text-sm text-gray-500">No services found</p>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Assets tab */}
        {tab === 'assets' && (
          <div className="card p-5">
            {(service.assets || []).length === 0 && <p className="text-gray-500 text-sm">No linked assets</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(service.assets || []).map(a => (
                <Link key={a.id} to={`/assets/${a.id}`} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700">
                  <StatusBadge status={a.status} />
                  <span className="text-sm font-medium">{a.name}</span>
                  <CriticalityBadge criticality={a.criticality} />
                </Link>
              ))}
            </div>
          </div>
        )}

        {tab === 'licenses' && (
          <div className="card p-5 space-y-4">
            {licenseRows.length === 0 && <p className="text-gray-500 text-sm">No active licenses available.</p>}
            {licenseRows.length > 0 && (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {licenseRows.map(l => (
                  <label key={l.id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                    <input
                      type="checkbox"
                      checked={!!l.assigned}
                      onChange={e => setLicenseRows(rows => rows.map(x => x.id === l.id ? { ...x, assigned: e.target.checked } : x))}
                      disabled={!canEdit}
                    />
                    <div className="text-sm">
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-gray-500">Status: {l.approval_status || 'n/a'} {l.expiry_date ? `| Expiry: ${String(l.expiry_date).slice(0, 10)}` : ''}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
            {canEdit && (
              <div className="flex justify-end">
                <button className="btn-primary" onClick={saveLicenses} disabled={savingLicenses}>{savingLicenses ? 'Saving...' : 'Save licenses'}</button>
              </div>
            )}
          </div>
        )}

        {/* Maintenance tab */}
        {tab === 'maintenance' && (
          <div className="space-y-2">
            {maintenance.length === 0 && <p className="text-gray-500 text-sm">No maintenance records</p>}
            {maintenance.map(m => (
              <Link key={m.id} to={`/maintenance/${m.id}`} className="card p-4 flex items-center justify-between hover:border-brand-300">
                <div>
                  <p className="font-medium text-sm">{m.title}</p>
                  <p className="text-xs text-gray-500">{format(new Date(m.scheduled_start), 'MMM dd yyyy HH:mm')}</p>
                </div>
                <StatusBadge status={m.status} />
              </Link>
            ))}
          </div>
        )}

        {/* Users tab */}
        {tab === 'users' && (
          <div className="card overflow-hidden">
            <div className="p-3 border-b border-gray-100 dark:border-gray-700">
              <input className="input text-sm" placeholder="Search users..."
                value={userSearch} onChange={e => { setUserSearch(e.target.value); setUserLimit(25) }} />
            </div>
            {filteredSubs.length === 0 ? (
              <p className="text-gray-500 text-sm p-5 text-center">No users subscribed to this service.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>{['Display Name','Username','Email','Notifications','Auth'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {visibleSubs.map(u => (
                    <tr key={u.id}>
                      <td className="px-4 py-2 font-medium">{u.display_name || u.username || u.email}</td>
                      <td className="px-4 py-2 text-gray-500">{u.username || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{u.email || '—'}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">
                        {[u.notify_maintenance && 'Maintenance', u.notify_incidents && 'Incidents', u.notify_recovery && 'Recovery'].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-4 py-2">{u.user_id ? <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-500">registered</span> : <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-yellow-100 text-yellow-700">email</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {filteredSubs.length > userLimit && (
              <div className="p-3 text-center border-t border-gray-100">
                <button className="text-sm text-brand-600 hover:underline" onClick={() => setUserLimit(l => l + 25)}>
                  Show {filteredSubs.length - userLimit} more
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {deleteConfirm && <ConfirmDialog title="Delete Service" message={`Delete "${service.name}"?`} danger confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setDeleteConfirm(false)} />}
    </Layout>
  )
}