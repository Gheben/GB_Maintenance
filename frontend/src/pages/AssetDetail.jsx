import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { ConfirmDialog, Modal } from '../components/Modal'
import { OwnerPickerModal } from '../components/OwnerPickerModal'
import { toast } from '../components/Toast'
import { assetsApi, usersApi, groupsApi, settingsApi } from '../api'
import { format } from 'date-fns'
import { Trash2, Play, ArrowLeft, Pencil, Save, X, Plus, User, Mail, Cog } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const CATEGORIES = ['application','infrastructure','database','network','hardware','api','other']
const CRITICALITIES = ['critical','high','medium','low']
const TABS = [['info','Info'],['deps','Dependencies'],['licenses','Licenses'],['probes','Probes'],['maintenance','Maintenance'],['users','Users']]

function approvalStatusMeta(status) {
  if (status === 'approved') return { label: 'Approved', cls: 'bg-green-100 text-green-700' }
  if (status === 'rejected') return { label: 'Rejected', cls: 'bg-red-100 text-red-700' }
  return { label: 'Pending', cls: 'bg-amber-100 text-amber-700' }
}

export default function AssetDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const [asset, setAsset] = useState(null)
  const [probes, setProbes] = useState([])
  const [maintenance, setMaintenance] = useState([])
  const [assetUsers, setAssetUsers] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [tab, setTab] = useState('info')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [probing, setProbing] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState('owner')
  // deps
  const [allAssets, setAllAssets] = useState([])
  const [depSearch, setDepSearch] = useState('')
  const [addingDep, setAddingDep] = useState(false)
  const [depDeleteTarget, setDepDeleteTarget] = useState(null)
  // owner
  const [ownerUsers, setOwnerUsers] = useState([])
  const [localGroups, setLocalGroups] = useState([])
  const [ldapEnabled, setLdapEnabled] = useState(false)
  const [licenseRows, setLicenseRows] = useState([])
  const [savingLicenses, setSavingLicenses] = useState(false)
  const [licensePickerOpen, setLicensePickerOpen] = useState(false)
  const [licenseSearch, setLicenseSearch] = useState('')
  const [licenseRemoveTarget, setLicenseRemoveTarget] = useState(null)
  const [usersModalOpen, setUsersModalOpen] = useState(false)

  const load = () => {
    assetsApi.get(id).then(r => setAsset(r.data)).catch(() => navigate('/assets'))
    assetsApi.probes(id, { limit: 25 }).then(r => setProbes(r.data))
    assetsApi.maintenance(id).then(r => setMaintenance(r.data))
  }
  
  useEffect(() => { load() }, [id])

  useEffect(() => {
    if (tab === 'users') {
      assetsApi.users(id).then(r => setAssetUsers(r.data)).catch(() => {})
    }
    if (tab === 'deps') {
      assetsApi.list({ limit: 500 }).then(r => {
        const list = Array.isArray(r.data) ? r.data : (r.data.data || [])
        setAllAssets(list.filter(a => a.id !== id))
      }).catch(() => {})
    }
    if (tab === 'licenses') {
      assetsApi.licenses(id).then(r => setLicenseRows(Array.isArray(r.data) ? r.data : [])).catch(() => setLicenseRows([]))
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
    if (!editMode || !canEdit) return
    setSavingLicenses(true)
    try {
      const selected = licenseRows.filter(l => l.assigned).map(l => l.id)
      await assetsApi.updateLicenses(id, selected)
      toast.success('Licenses updated')
      const r = await assetsApi.licenses(id)
      setLicenseRows(Array.isArray(r.data) ? r.data : [])
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error updating licenses')
    } finally {
      setSavingLicenses(false)
    }
  }

  const handleProbeNow = async () => {
    setProbing(true)
    try {
      await assetsApi.probeNow(id)
      toast.success('Probe started')
      const r = await assetsApi.probes(id, { limit: 25 })
      setProbes(r.data)
      const ar = await assetsApi.get(id)
      setAsset(ar.data)
    } catch (err) { toast.error('Probe error') }
    finally { setProbing(false) }
  }

  const handleDelete = async () => {
    try { await assetsApi.delete(id); toast.success('Asset deleted'); navigate('/assets') }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const enterEdit = () => {
    if (!asset) return
    loadOwnerData()
    const ownerTargets = Array.isArray(asset.owner_targets) && asset.owner_targets.length > 0
      ? asset.owner_targets
      : (() => {
        if (asset.owner_type === 'user' && asset.owner_id) return [{ type: 'user', id: asset.owner_id, name: asset.owner_name || asset.owner_label || 'User', email: asset.owner_email || '' }]
        if (asset.owner_type === 'local_group' && asset.owner_group_id) return [{ type: 'local_group', id: asset.owner_group_id, name: asset.owner_group_name || asset.owner_label || 'Group' }]
        if (['ldap_user', 'ldap_group'].includes(asset.owner_type) && asset.owner_ldap_dn) return [{ type: asset.owner_type, dn: asset.owner_ldap_dn, name: asset.owner_ldap_name || asset.owner_ldap_dn }]
        return []
      })()
    setEditForm({
      name: asset.name || '',
      category: asset.category || 'application',
      criticality: asset.criticality || 'medium',
      description: asset.description || '',
      owner_targets: ownerTargets,
      user_targets: Array.isArray(asset.user_targets) ? asset.user_targets : [],
      owner_type: asset.owner_type || 'user',
      owner_id: asset.owner_id || '',
      owner_group_id: asset.owner_group_id || '',
      owner_ldap_dn: asset.owner_ldap_dn || '',
      owner_ldap_name: asset.owner_ldap_name || '',
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

      await assetsApi.update(id, {
        name: editForm.name,
        category: editForm.category,
        criticality: editForm.criticality,
        description: editForm.description || null,
        owner_targets: ownerTargets,
        user_targets: Array.isArray(editForm.user_targets) ? editForm.user_targets : [],
        owner_type: firstOwner?.type || 'user',
        owner_id: firstOwner?.type === 'user' ? (firstOwner.id || null) : null,
        owner_group_id: firstOwner?.type === 'local_group' ? (firstOwner.id || null) : null,
        owner_ldap_dn: ['ldap_user', 'ldap_group'].includes(firstOwner?.type) ? (firstOwner.dn || null) : null,
        owner_ldap_name: ['ldap_user', 'ldap_group'].includes(firstOwner?.type) ? (firstOwner.name || firstOwner.dn || null) : null,
      })
      toast.success('Asset updated')
      setEditMode(false)
      setEditForm(null)
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
    finally { setSaving(false) }
  }

  const addDep = async (depId) => {
    try { await assetsApi.addDependency(id, depId); toast.success('Dependency added'); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const removeDep = async (depId) => {
    try { await assetsApi.removeDependency(id, depId); toast.success('Dependency removed'); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const confirmRemoveDependency = async () => {
    if (!depDeleteTarget) return
    await removeDep(depDeleteTarget.id)
    setDepDeleteTarget(null)
  }

  const confirmRemoveLicense = () => {
    if (!licenseRemoveTarget) return
    setLicenseRows((rows) => rows.map((x) => x.id === licenseRemoveTarget.id ? { ...x, assigned: false } : x))
    setLicenseRemoveTarget(null)
  }

  if (!asset) return <Layout title="Asset"><div className="text-center py-16 text-gray-500">Loading...</div></Layout>

  const canEdit = hasRole('superadmin','admin')
  const existingDepIds = new Set((asset.dependsOn || []).map(d => d.id))
  const filteredDeps = allAssets.filter(a =>
    a.name.toLowerCase().includes(depSearch.toLowerCase()) && !existingDepIds.has(a.id)
  )
  const q = userSearch.toLowerCase()
  const filteredUsers = assetUsers.filter((u) => {
    const matchesSearch = !q ||
      (u.display_name||'').toLowerCase().includes(q) ||
      (u.username||'').toLowerCase().includes(q) ||
      (u.email||'').toLowerCase().includes(q)
    return matchesSearch
  })
  const impactedOffices = [...new Set(assetUsers.map((u) => String(u.office || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const assignedLicenseRows = licenseRows.filter((l) => !!l.assigned)
  const availableLicenseRows = licenseRows.filter((l) => !l.assigned)
  const filteredAvailableLicenseRows = availableLicenseRows.filter((l) => {
    const q = String(licenseSearch || '').trim().toLowerCase()
    if (!q) return true
    return String(l.name || '').toLowerCase().includes(q)
      || String(l.approval_status || '').toLowerCase().includes(q)
      || String(l.supplier_name || '').toLowerCase().includes(q)
  })
  const assignedTargets = Array.isArray(asset.user_targets) ? asset.user_targets : []

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
    <Layout title={asset.name}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/assets" className="flex items-center gap-1 text-gray-500 hover:text-gray-700 text-sm"><ArrowLeft size={16} />Assets</Link>
          <div className="flex gap-2">
            {!editMode && canEdit && <button className="btn-secondary flex items-center gap-1" onClick={enterEdit}><Pencil size={14} />Edit</button>}
            {editMode && (
              <>
                <button className="btn-secondary flex items-center gap-1" onClick={cancelEdit} disabled={saving}><X size={14} />Cancel</button>
                <button className="btn-primary flex items-center gap-1" onClick={saveEdit} disabled={saving}><Save size={14} />{saving ? 'Saving...' : 'Save'}</button>
              </>
            )}
            {!editMode && asset.probe_enabled && <button className="btn-secondary flex items-center gap-1" disabled={probing} onClick={handleProbeNow}><Play size={14} />{probing ? 'Probing...' : 'Probe now'}</button>}
            {!editMode && canEdit && <button className="btn-danger flex items-center gap-1" onClick={() => setDeleteConfirm(true)}><Trash2 size={14} />Delete</button>}
          </div>
        </div>

        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {TABS.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === key ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'info' && (editMode && editForm ? (
          <div className="card p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input className="input" value={editForm.name} onChange={e => setEditForm(f => ({...f, name: e.target.value}))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                <select className="input" value={editForm.category} onChange={e => setEditForm(f => ({...f, category: e.target.value}))}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Criticality</label>
                <select className="input" value={editForm.criticality} onChange={e => setEditForm(f => ({...f, criticality: e.target.value}))}>
                  {CRITICALITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input" rows={3} value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))} />
            </div>
            {ownerFieldsJsx}
            {usersFieldsJsx}
          </div>
        ) : (
          <div className="card p-6">
            <div className="flex flex-wrap gap-3 mb-4">
              <StatusBadge status={asset.status} />
              <CriticalityBadge criticality={asset.criticality} />
              <span className="badge bg-gray-100 text-gray-700">{asset.category}</span>
            </div>
            <p className="text-gray-600 dark:text-gray-300">{asset.description || 'No description'}</p>
            {(asset.owner_label || asset.owner_name) && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <User size={14} className="text-gray-400" />
                <span className="font-medium text-gray-700 dark:text-gray-300">Owner:</span>
                <span>{asset.owner_label || asset.owner_name}</span>
                {asset.owner_email && <a href={`mailto:${asset.owner_email}`} className="flex items-center gap-1 text-brand-600 hover:underline text-xs"><Mail size={12} />{asset.owner_email}</a>}
              </div>
            )}
            {asset.probe_enabled && (
              <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
                <strong>Probe:</strong> {asset.probe_type} → {asset.probe_url} | Interval: {asset.probe_interval_seconds}s
              </div>
            )}
          </div>
        ))}

        {tab === 'deps' && (
          <div className="card p-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium mb-3 text-sm">Depends on</h3>
                {(asset.dependsOn || []).length === 0 && <p className="text-gray-500 text-sm">No dependencies</p>}
                {(asset.dependsOn || []).map(a => (
                  <div key={a.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <Link to={`/assets/${a.id}`} className="text-sm text-brand-600 hover:underline flex items-center gap-1.5">
                      <Cog size={13} />{a.name}
                    </Link>
                    {editMode && canEdit && <button onClick={() => setDepDeleteTarget({ id: a.id, name: a.name })} className="text-xs text-red-400 hover:text-red-600 ml-2"><X size={13} /></button>}
                  </div>
                ))}
              </div>
              <div>
                <h3 className="font-medium mb-3 text-sm">Required by</h3>
                {(asset.requiredBy || []).length === 0 && <p className="text-gray-500 text-sm">None</p>}
                {(asset.requiredBy || []).map(a => (
                  <Link key={a.id} to={`/assets/${a.id}`} className="block text-sm text-brand-600 hover:underline py-1">{a.name}</Link>
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
                      <input className="input py-1 text-sm" placeholder="Search asset..." value={depSearch} onChange={e => setDepSearch(e.target.value)} />
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
                      {filteredDeps.slice(0, 25).map(a => (
                        <button key={a.id} type="button" onClick={() => { addDep(a.id); setAddingDep(false); setDepSearch('') }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 dark:hover:bg-brand-900/20 flex items-center justify-between">
                          <span>{a.name}</span>
                          <StatusBadge status={a.status} />
                        </button>
                      ))}
                      {filteredDeps.length === 0 && <p className="text-center py-4 text-sm text-gray-500">No assets found</p>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'probes' && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>{['Result','Resp. ms','Status','Date'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {probes.map(p => (
                  <tr key={p.id}>
                    <td className="px-4 py-2">{p.success ? '✅' : '❌'}</td>
                    <td className="px-4 py-2">{p.response_time_ms ?? '—'}</td>
                    <td className="px-4 py-2">{p.status_code ?? p.error_message ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-500">{format(new Date(p.probed_at), 'MM/dd HH:mm:ss')}</td>
                  </tr>
                ))}
                {probes.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">No probe history</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'licenses' && (
          <div className="card p-5 space-y-4">
            {assignedLicenseRows.length === 0 && <p className="text-gray-500 text-sm">No assigned licenses.</p>}
            {assignedLicenseRows.length > 0 && (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {assignedLicenseRows.map(l => (
                  <div key={l.id} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="text-sm">
                      <div className="font-medium">{l.name}</div>
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        <span className={`px-2 py-0.5 rounded-full ${approvalStatusMeta(l.approval_status).cls}`}>{approvalStatusMeta(l.approval_status).label}</span>
                        {l.expiry_date && <span className="text-gray-500">Expiry: {String(l.expiry_date).slice(0, 10)}</span>}
                      </div>
                    </div>
                    {canEdit && editMode && (
                      <button
                        type="button"
                        className="text-xs text-red-500 hover:text-red-700"
                        onClick={() => setLicenseRemoveTarget({ id: l.id, name: l.name })}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canEdit && editMode && (
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setLicensePickerOpen(true)}>
                  Add license
                </button>
                <button className="btn-primary" onClick={saveLicenses} disabled={savingLicenses}>{savingLicenses ? 'Saving...' : 'Save licenses'}</button>
              </div>
            )}

            {licensePickerOpen && (
              <Modal title="Add License" onClose={() => { setLicensePickerOpen(false); setLicenseSearch('') }} size="lg">
                <div className="space-y-3">
                  <input
                    className="w-full h-10 px-3 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
                    placeholder="Search license..."
                    value={licenseSearch}
                    onChange={(e) => setLicenseSearch(e.target.value)}
                  />
                  <div className="max-h-[50vh] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-md">
                    {filteredAvailableLicenseRows.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                        onClick={() => setLicenseRows(rows => rows.map(x => x.id === l.id ? { ...x, assigned: true } : x))}
                      >
                        <div className="text-sm font-medium">{l.name}</div>
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <span className={`px-2 py-0.5 rounded-full ${approvalStatusMeta(l.approval_status).cls}`}>{approvalStatusMeta(l.approval_status).label}</span>
                          {l.expiry_date && <span className="text-gray-500">Expiry: {String(l.expiry_date).slice(0, 10)}</span>}
                        </div>
                      </button>
                    ))}
                    {filteredAvailableLicenseRows.length === 0 && <p className="px-3 py-4 text-sm text-gray-500">No licenses available to add.</p>}
                  </div>
                  <div className="flex justify-end">
                    <button type="button" className="btn-secondary" onClick={() => { setLicensePickerOpen(false); setLicenseSearch('') }}>Done</button>
                  </div>
                </div>
              </Modal>
            )}
          </div>
        )}

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

        {tab === 'users' && (
          <div className="card overflow-hidden">
            <div className="p-3 border-b border-gray-100 dark:border-gray-700">
              {assignedTargets.length > 0 && (
                <div className="mb-3">
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
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Offices involved ({impactedOffices.length})</p>
                {impactedOffices.length === 0 ? (
                  <p className="text-xs text-gray-400">No office data available</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {impactedOffices.map((office) => (
                      <span
                        key={office}
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                      >
                        {office}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-start">
                <button type="button" className="btn-secondary" onClick={() => setUsersModalOpen(true)}>
                  Show users ({filteredUsers.length})
                </button>
              </div>
            </div>
            {filteredUsers.length === 0 && (
              <p className="text-gray-500 text-sm p-5 text-center">
                {assignedTargets.length > 0
                  ? 'Targets are assigned, but no local users were resolved from current mappings.'
                  : 'No software users assigned to this asset.'}
              </p>
            )}

            {usersModalOpen && (
              <Modal title="Users involved" onClose={() => setUsersModalOpen(false)} size="xl">
                <div className="space-y-3">
                  <input
                    className="input text-sm"
                    placeholder="Search users..."
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                  />
                  <div className="max-h-[60vh] overflow-auto border border-gray-200 dark:border-gray-700 rounded-md">
                    {filteredUsers.length === 0 ? (
                      <p className="text-gray-500 text-sm p-5 text-center">No users match current filters.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                          <tr>{['Display Name','Username','Email','Office','Role','Auth'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          {filteredUsers.map(u => (
                            <tr key={u.id}>
                              <td className="px-4 py-2 font-medium">{u.display_name || u.username}</td>
                              <td className="px-4 py-2 text-gray-500">{u.username}</td>
                              <td className="px-4 py-2 text-gray-500">{u.email || '—'}</td>
                              <td className="px-4 py-2 text-gray-500">{u.office || '—'}</td>
                              <td className="px-4 py-2 text-gray-500">{u.role}</td>
                              <td className="px-4 py-2"><span className={`px-1.5 py-0.5 rounded text-xs font-bold ${u.auth_type === 'ldap' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{u.auth_type || 'local'}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <button type="button" className="btn-secondary" onClick={() => setUsersModalOpen(false)}>Close</button>
                  </div>
                </div>
              </Modal>
            )}
          </div>
        )}
      </div>

      {deleteConfirm && (
        <ConfirmDialog title="Delete Asset" message={`Delete "${asset.name}"?`} danger confirmLabel="Delete"
          onConfirm={handleDelete} onCancel={() => setDeleteConfirm(false)} />
      )}

      {depDeleteTarget && (
        <ConfirmDialog
          title="Remove Dependency"
          message={`Remove dependency "${depDeleteTarget.name}" from this asset?`}
          danger
          confirmLabel="Remove"
          onConfirm={confirmRemoveDependency}
          onCancel={() => setDepDeleteTarget(null)}
        />
      )}

      {licenseRemoveTarget && (
        <ConfirmDialog
          title="Remove License"
          message={`Remove license "${licenseRemoveTarget.name}" from this asset?`}
          danger
          confirmLabel="Remove"
          onConfirm={confirmRemoveLicense}
          onCancel={() => setLicenseRemoveTarget(null)}
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