import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { ConfirmDialog } from '../components/Modal'
import { OwnerPickerModal } from '../components/OwnerPickerModal'
import { toast } from '../components/Toast'
import { servicesApi, usersApi, groupsApi, settingsApi } from '../api'
import { format } from 'date-fns'
import { Trash2, ArrowLeft, Pencil, Save, X, Plus, ExternalLink, User, Mail, Cog } from 'lucide-react'
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
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState('owner')
  const [depSearch, setDepSearch] = useState('')
  const [addingDep, setAddingDep] = useState(false)
  const [depDeleteTarget, setDepDeleteTarget] = useState(null)
  const [userSearch, setUserSearch] = useState('')
  const [userLimit, setUserLimit] = useState(25)
  const [serviceUsers, setServiceUsers] = useState([])
  const [selectedOffice, setSelectedOffice] = useState('')
  
  // Owner states
  const [ownerUsers, setOwnerUsers] = useState([])
  const [localGroups, setLocalGroups] = useState([])
  const [ldapEnabled, setLdapEnabled] = useState(false)
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
    if (tab === 'users') {
      servicesApi.users(id).then(r => setServiceUsers(Array.isArray(r.data) ? r.data : [])).catch(() => setServiceUsers([]))
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
    const ownerTargets = Array.isArray(service.owner_targets) && service.owner_targets.length > 0
      ? service.owner_targets
      : (() => {
        if (service.owner_type === 'user' && service.owner_id) return [{ type: 'user', id: service.owner_id, name: service.owner_name || service.owner_label || 'User', email: service.owner_email || '' }]
        if (service.owner_type === 'local_group' && service.owner_group_id) return [{ type: 'local_group', id: service.owner_group_id, name: service.owner_group_name || service.owner_label || 'Group' }]
        if (['ldap_user', 'ldap_group'].includes(service.owner_type) && service.owner_ldap_dn) return [{ type: service.owner_type, dn: service.owner_ldap_dn, name: service.owner_ldap_name || service.owner_ldap_dn }]
        return []
      })()
    setEditForm({
      name: service.name || '',
      description: service.description || '',
      criticality: service.criticality || 'medium',
      sla_target: service.sla_target || service.sla_uptime_percent || '',
      system_name: service.system_name || '',
      is_public: !!service.is_public,
      owner_targets: ownerTargets,
      user_targets: Array.isArray(service.user_targets) ? service.user_targets : [],
      owner_type: service.owner_type || 'user',
      owner_id: service.owner_id || '',
      owner_group_id: service.owner_group_id || '',
      owner_ldap_dn: service.owner_ldap_dn || '',
      owner_ldap_name: service.owner_ldap_name || '',
    })
    setEditMode(true)
    setTab('info')
  }

  const cancelEdit = () => { setEditMode(false); setEditForm(null) }

  const saveEdit = async () => {
    if (!editForm.name.trim()) { toast.error('Name is required'); return }
    const ownerTargets = Array.isArray(editForm.owner_targets) ? editForm.owner_targets : []
    if (ownerTargets.length < 1) {
      toast.error('At least one owner is required')
      return
    }

    setSaving(true)
    try {
      const firstOwner = ownerTargets[0] || null

      await servicesApi.update(id, {
        name: editForm.name,
        description: editForm.description || null,
        criticality: editForm.criticality,
        sla_uptime_percent: editForm.sla_target ? parseFloat(editForm.sla_target) : undefined,
        system_name: editForm.system_name || null,
        is_public: !!editForm.is_public,
        owner_targets: ownerTargets,
        user_targets: Array.isArray(editForm.user_targets) ? editForm.user_targets : [],
        owner_type: firstOwner?.type || 'user',
        owner_id: firstOwner?.type === 'user' ? (firstOwner.id || null) : null,
        owner_group_id: firstOwner?.type === 'local_group' ? (firstOwner.id || null) : null,
        owner_ldap_dn: ['ldap_user', 'ldap_group'].includes(firstOwner?.type) ? (firstOwner.dn || null) : null,
        owner_ldap_name: ['ldap_user', 'ldap_group'].includes(firstOwner?.type) ? (firstOwner.name || firstOwner.dn || null) : null,
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

  const confirmRemoveDependency = async () => {
    if (!depDeleteTarget) return
    await removeDep(depDeleteTarget.id)
    setDepDeleteTarget(null)
  }

  if (!service) return <Layout title="Service"><div className="text-center py-16 text-gray-500">Loading...</div></Layout>

  const canEdit = hasRole('superadmin', 'admin')
  const existingDepIds = new Set((service.depends_on || []).map(d => d.id))
  const filteredServices = allServices.filter(s =>
    s.name.toLowerCase().includes(depSearch.toLowerCase()) && !existingDepIds.has(s.id)
  )
  const qU = userSearch.toLowerCase()
  const filteredUsers = serviceUsers.filter((u) => {
    const matchesSearch = !qU ||
      (u.display_name||'').toLowerCase().includes(qU) ||
      (u.username||'').toLowerCase().includes(qU) ||
      (u.email||'').toLowerCase().includes(qU)
    const matchesOffice = !selectedOffice || String(u.office || '').trim() === selectedOffice
    return matchesSearch && matchesOffice
  })
  const visibleUsers = filteredUsers.slice(0, userLimit)
  const impactedOffices = [...new Set(serviceUsers.map((u) => String(u.office || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const assignedTargets = Array.isArray(service.user_targets) ? service.user_targets : []

  const ownerFieldsJsx = (
    <div>
      <label className="block text-sm font-medium mb-1">Owner *</label>
      <div className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
        <div className="text-xs text-gray-600 dark:text-gray-300">
          {editForm?.owner_targets?.length > 0 ? `${editForm.owner_targets.length} owner(s) selected` : 'No owners selected'}
        </div>
        <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" onClick={() => { setPickerTarget('owner'); setOwnerPickerOpen(true) }}>
          Select owner
        </button>
      </div>
      {(editForm?.owner_targets || []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {editForm.owner_targets.map((o, idx) => (
            <span key={`${o.type}:${o.id || o.dn || idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-brand-100 text-brand-700">
              {o.name || o.id || o.dn}
              <span className="opacity-70">{o.type}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )

  const usersFieldsJsx = (
    <div>
      <label className="block text-sm font-medium mb-1">Users / Groups</label>
      <div className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
        <div className="text-xs text-gray-600 dark:text-gray-300">
          {editForm?.user_targets?.length > 0 ? `${editForm.user_targets.length} user/group target(s) selected` : 'No user/group targets selected'}
        </div>
        <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" onClick={() => { setPickerTarget('users'); setOwnerPickerOpen(true) }}>
          Select users/groups
        </button>
      </div>
      {(editForm?.user_targets || []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {editForm.user_targets.map((t, idx) => (
            <span key={`${t.type}:${t.id || t.dn || idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
              {t.name || t.id || t.dn}
              <span className="opacity-70">{t.type}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )

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
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="service-public-detail"
                checked={!!editForm.is_public}
                onChange={e => setEditForm(f => ({ ...f, is_public: e.target.checked }))}
              />
              <label htmlFor="service-public-detail" className="text-sm">Visible on public status page</label>
            </div>
            {ownerFieldsJsx}
            {usersFieldsJsx}
          </div>
        ) : (
          <div className="card p-6">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <StatusBadge status={service.status || service.current_status} />
              <CriticalityBadge criticality={service.criticality} />
              {service.system_name && <span className="badge bg-indigo-100 text-indigo-700">{service.system_name}</span>}
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
                    {editMode && canEdit && <button onClick={() => setDepDeleteTarget({ id: s.id, name: s.name })} className="text-xs text-red-400 hover:text-red-600 ml-2"><X size={13} /></button>}
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
            {editMode && canEdit && (
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
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Offices involved ({impactedOffices.length})</p>
                {impactedOffices.length === 0 ? (
                  <p className="text-xs text-gray-400">No office data available</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setSelectedOffice(''); setUserLimit(25) }}
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs border ${selectedOffice === '' ? 'bg-brand-100 text-brand-700 border-brand-200' : 'bg-white text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'}`}
                    >
                      All offices
                    </button>
                    {impactedOffices.map((office) => (
                      <button
                        type="button"
                        key={office}
                        onClick={() => { setSelectedOffice(office); setUserLimit(25) }}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${selectedOffice === office ? 'bg-indigo-200 text-indigo-900 dark:bg-indigo-700/60 dark:text-indigo-100' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'}`}
                      >
                        {office}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input className="input text-sm" placeholder="Search users..."
                value={userSearch} onChange={e => { setUserSearch(e.target.value); setUserLimit(25) }} />
            </div>
            {assignedTargets.length > 0 && (
              <div className="px-4 pt-3 pb-1">
                <p className="text-xs font-medium text-gray-500 mb-2">Assigned targets</p>
                <div className="flex flex-wrap gap-1.5">
                  {assignedTargets.map((t, idx) => (
                    <span key={`${t.type}:${t.id || t.dn || idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
                      {t.name || t.id || t.dn}
                      <span className="opacity-70">{t.type}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {filteredUsers.length === 0 ? (
              <p className="text-gray-500 text-sm p-5 text-center">
                {assignedTargets.length > 0
                  ? 'Targets are assigned, but no local users were resolved from current mappings.'
                  : 'No software users assigned to this service.'}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>{['Display Name','Username','Email','Office','Role','Auth'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {visibleUsers.map(u => (
                    <tr key={u.id}>
                      <td className="px-4 py-2 font-medium">{u.display_name || u.username || u.email}</td>
                      <td className="px-4 py-2 text-gray-500">{u.username || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{u.email || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{u.office || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{u.role || '—'}</td>
                      <td className="px-4 py-2"><span className={`px-1.5 py-0.5 rounded text-xs font-bold ${u.auth_type === 'ldap' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{u.auth_type || 'local'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {filteredUsers.length > userLimit && (
              <div className="p-3 text-center border-t border-gray-100">
                <button className="text-sm text-brand-600 hover:underline" onClick={() => setUserLimit(l => l + 25)}>
                  Show {filteredUsers.length - userLimit} more
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {deleteConfirm && <ConfirmDialog title="Delete Service" message={`Delete "${service.name}"?`} danger confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setDeleteConfirm(false)} />}

      {depDeleteTarget && (
        <ConfirmDialog
          title="Remove Dependency"
          message={`Remove dependency "${depDeleteTarget.name}" from this service?`}
          danger
          confirmLabel="Remove"
          onConfirm={confirmRemoveDependency}
          onCancel={() => setDepDeleteTarget(null)}
        />
      )}

      <OwnerPickerModal
        open={ownerPickerOpen}
        onClose={() => setOwnerPickerOpen(false)}
        value={pickerTarget === 'owner' ? (editForm?.owner_targets || []) : (editForm?.user_targets || [])}
        onChange={(targets) => setEditForm(f => (f ? (pickerTarget === 'owner' ? { ...f, owner_targets: targets } : { ...f, user_targets: targets }) : f))}
        users={ownerUsers}
        localGroups={localGroups}
        ldapEnabled={ldapEnabled}
      />
    </Layout>
  )
}