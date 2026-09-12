import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { ConfirmDialog, Modal } from '../components/Modal'
import { ItemPicker } from '../components/ItemPicker'
import { OwnerPickerModal } from '../components/OwnerPickerModal'
import { toast } from '../components/Toast'
import { assetsApi, assetCategoriesApi, usersApi, groupsApi, settingsApi, licensesApi } from '../api'
import { Plus, Search, RefreshCw, Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const CATEGORIES = ['application','infrastructure','database','network','hardware','api','other']
const CRITICALITIES = ['critical','high','medium','low']

function parsePublicApiDate(value) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value

  const text = String(value).trim()
  if (!text) return null

  const parsedNative = new Date(text)
  if (!Number.isNaN(parsedNative.getTime())) return parsedNative

  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:,\s*(\d{2}):(\d{2}))?$/)
  if (!m) return null

  const day = Number(m[1])
  const month = Number(m[2])
  const year = Number(m[3])
  const hour = m[4] ? Number(m[4]) : 0
  const minute = m[5] ? Number(m[5]) : 0
  const d = new Date(year, month - 1, day, hour, minute)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDateOnlyLabel(value) {
  if (!value) return ''

  const text = String(value).trim()
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return text

  const d = parsePublicApiDate(value)
  if (!d) return text

  return d.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function LicenseState({ row }) {
  const total = Number(row.license_count || 0)
  const expired = Number(row.expired_license_count || 0)
  const next = parsePublicApiDate(row.next_license_expiry)

  if (!total) return <span className="text-gray-400">—</span>

  let badge = <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Active</span>
  if (expired > 0) badge = <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Expired</span>
  if (next && !Number.isNaN(next.getTime())) {
    const days = Math.ceil((next.getTime() - Date.now()) / 86400000)
    const date = formatDateOnlyLabel(next)
    if (days <= 30) badge = <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Expiring {date}</span>
    else badge = <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Valid {date}</span>
  }

  return (
    <div className="flex flex-col items-center text-center space-y-0.5">
      <div>{badge}</div>
      {row.primary_license_name && <div className="text-[11px] text-gray-500 leading-tight">{row.primary_license_name}</div>}
      {row.primary_supplier_name && <div className="text-[11px] text-gray-400 leading-tight">{row.primary_supplier_name}</div>}
    </div>
  )
}

function ProbeState({ row }) {
  if (!row.probe_enabled && !row.probe_enabled_count) return <span className="text-gray-400">—</span>
  const hasAnyFailingProbe = Number(row.failing_probe_count || 0) > 0
  const hasWarning = !!row.latest_probe_error_message && row.latest_probe_success !== false && !hasAnyFailingProbe
  const dotClass = hasAnyFailingProbe || row.latest_probe_success === false
    ? 'bg-red-500'
    : hasWarning
      ? 'bg-amber-500 animate-pulse'
      : 'bg-green-500'
  const method = String(row.latest_probe_type || row.probe_type || 'probe').toUpperCase()
  const label = hasAnyFailingProbe || row.latest_probe_success === false
    ? (row.latest_probe_error_message || 'Probe failed')
    : hasWarning
      ? row.latest_probe_error_message
      : 'Probe healthy'
  const probeCount = Number(row.probe_enabled_count || 0)
  const probeName = row.primary_probe_name || 'Probe'
  
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className={`w-2.5 h-2.5 rounded-full ${dotClass}`} title={label} />
      <span className="font-medium text-gray-700 dark:text-gray-200">{method}</span>
      {probeCount > 1 ? (
        <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
          {probeName} <span className="font-semibold">+{probeCount - 1}</span>
        </span>
      ) : probeCount === 1 && probeName && (
        <span className="text-[10px] text-gray-600">{probeName}</span>
      )}
    </span>
  )
}

export default function Assets() {
  const { hasPermission, hasRole } = useAuth()
  const canEdit = hasPermission('assets')
  const canBulkDelete = hasRole('superadmin', 'admin')
  const [assets, setAssets] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [search, setSearch] = useState('')
  const [filterCrit, setFilterCrit] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState({ name: '', category: 'application', criticality: 'medium', description: '', part_is_relevant: false, owner_targets: [], user_targets: [], probe_enabled: false, probe_type: 'https', probe_url: '', probe_interval_seconds: 300, probe_timeout_seconds: 10, expected_status_code: 200, failure_threshold: 2, recovery_threshold: 2, pause_during_maintenance: true, dns_record_type: 'A', dns_expected_value: '', ssl_expiry_warning_days: 30 })
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState('owner')
  const [users, setUsers] = useState([])
  const [localGroups, setLocalGroups] = useState([])
  const [ldapEnabled, setLdapEnabled] = useState(false)
  const [createDepIds, setCreateDepIds] = useState([])
  const [editDepIds, setEditDepIds] = useState([])
  const [editOrigDepIds, setEditOrigDepIds] = useState([])
  const [allLicenses, setAllLicenses] = useState([])
  const [createLicenseIds, setCreateLicenseIds] = useState([])
  const [editLicenseIds, setEditLicenseIds] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedAssetIds, setSelectedAssetIds] = useState([])
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    assetsApi.list({ search, criticality: filterCrit, status: filterStatus, page, limit })
      .then(r => { setAssets(r.data.data); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }, [search, filterCrit, filterStatus, page, limit])

  useEffect(() => { load() }, [load])
  useEffect(() => { assetCategoriesApi.list().then(r => setCategories(r.data)).catch(() => setCategories(CATEGORIES.map(s => ({ slug: s, label: s, color: '#6366f1' })))) }, [])

  useEffect(() => {
    setSelectedAssetIds(prev => prev.filter(id => assets.some(a => a.id === id)))
  }, [assets])

  useEffect(() => {
    usersApi.list({ limit: 200 }).then(r => setUsers(Array.isArray(r.data) ? r.data : (r.data.data || []))).catch(() => {})
    groupsApi.list().then(r => {
      const rows = Array.isArray(r.data) ? r.data : []
      setLocalGroups(rows.map(g => ({
        ...g,
        type: Number(g.ldap_mapping_count || 0) > 0 ? 'ldap_group' : 'local_group',
      })))
    }).catch(() => {})
    settingsApi.getLdapEnabled().then(r => setLdapEnabled(!!(r.data?.enabled))).catch(() => {})
    licensesApi.list({ limit: 500 }).then(r => {
      const rows = Array.isArray(r.data) ? r.data : (r.data.data || [])
      setAllLicenses(rows)
    }).catch(() => {})
  }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    const ownerTargets = Array.isArray(form.owner_targets) ? form.owner_targets : []
    if (ownerTargets.length < 1) {
      toast.error('At least one owner is required')
      return
    }
    const firstOwner = ownerTargets[0] || null
    const payload = {
      ...form,
      owner_id: firstOwner?.type === 'user' ? firstOwner.id : undefined,
      owner_type: firstOwner?.type || 'user',
      owner_group_id: firstOwner?.type === 'local_group' ? firstOwner.id : undefined,
      owner_ldap_dn: ['ldap_user', 'ldap_group'].includes(firstOwner?.type) ? firstOwner.dn : undefined,
      owner_ldap_name: ['ldap_user', 'ldap_group'].includes(firstOwner?.type) ? firstOwner.name : undefined,
      user_targets: Array.isArray(form.user_targets) ? form.user_targets : [],
    }
    try {
      const res = await assetsApi.create(payload)
      const newId = res.data?.id
      if (newId) {
        await assetsApi.updateLicenses(newId, createLicenseIds).catch(() => {})
        for (const depId of createDepIds) {
          await assetsApi.addDependency(newId, depId).catch(() => {})
        }
      }
      toast.success('Asset created')
      setShowCreate(false)
      setForm({ name: '', category: 'application', criticality: 'medium', description: '', part_is_relevant: false, owner_targets: [], user_targets: [], probe_enabled: false, probe_type: 'https', probe_url: '', probe_interval_seconds: 300, probe_timeout_seconds: 10, expected_status_code: 200, failure_threshold: 2, recovery_threshold: 2, pause_during_maintenance: true, dns_record_type: 'A', dns_expected_value: '', ssl_expiry_warning_days: 30 })
      setCreateDepIds([])
      setCreateLicenseIds([])
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const openEdit = async (a) => {
    setEditTarget(a)
    const ownerTargets = Array.isArray(a.owner_targets) && a.owner_targets.length > 0
      ? a.owner_targets
      : (() => {
        if (a.owner_type === 'user' && a.owner_id) return [{ type: 'user', id: a.owner_id, name: a.owner_name || a.owner_label || 'User', email: a.owner_email || '' }]
        if (a.owner_type === 'local_group' && a.owner_group_id) return [{ type: 'local_group', id: a.owner_group_id, name: a.owner_group_name || a.owner_label || 'Group' }]
        if (['ldap_user', 'ldap_group'].includes(a.owner_type) && a.owner_ldap_dn) return [{ type: a.owner_type, dn: a.owner_ldap_dn, name: a.owner_ldap_name || a.owner_ldap_dn }]
        return []
      })()
    setForm({
      name: a.name, category: a.category, criticality: a.criticality, description: a.description || '',
      part_is_relevant: a.part_is_relevant === true,
      owner_targets: ownerTargets,
      user_targets: Array.isArray(a.user_targets) ? a.user_targets : [],
      probe_enabled: a.probe_enabled || false,
      probe_type: a.probe_type || 'https',
      probe_url: a.probe_url || '',
      probe_interval_seconds: a.probe_interval_seconds ?? 300,
      probe_timeout_seconds: a.probe_timeout_seconds ?? 10,
      expected_status_code: a.expected_status_code ?? 200,
      failure_threshold: a.failure_threshold ?? 2,
      recovery_threshold: a.recovery_threshold ?? 2,
      pause_during_maintenance: a.pause_during_maintenance !== false,
    })
    try {
      const r = await assetsApi.get(a.id)
      const depIds = (r.data.dependsOn || []).map(d => d.id)
      setEditDepIds(depIds)
      setEditOrigDepIds(depIds)
      const lr = await assetsApi.licenses(a.id)
      const rows = Array.isArray(lr.data) ? lr.data : []
      setAllLicenses(rows)
      setEditLicenseIds(rows.filter(l => l.assigned).map(l => l.id))
    } catch {
      setEditDepIds([])
      setEditOrigDepIds([])
      setEditLicenseIds([])
    }
  }

  const ownerFieldsJsx = (
    <div>
      <label className="block text-sm font-medium mb-1">Owner *</label>
      <div className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
        <div className="text-xs text-gray-600 dark:text-gray-300">
          {form.owner_targets?.length > 0 ? `${form.owner_targets.length} owner(s) selected` : 'No owners selected'}
        </div>
        <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" onClick={() => { setPickerTarget('owner'); setOwnerPickerOpen(true) }}>
          Select owner
        </button>
      </div>
      {(form.owner_targets || []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {form.owner_targets.map((o, idx) => (
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
          {form.user_targets?.length > 0 ? `${form.user_targets.length} user/group target(s) selected` : 'No user/group targets selected'}
        </div>
        <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" onClick={() => { setPickerTarget('users'); setOwnerPickerOpen(true) }}>
          Select users/groups
        </button>
      </div>
      {(form.user_targets || []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {form.user_targets.map((o, idx) => (
            <span key={`${o.type}:${o.id || o.dn || idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
              {o.name || o.id || o.dn}
              <span className="opacity-70">{o.type}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )

  const handleEdit = async (e) => {
    e.preventDefault()
    const ownerTargets = Array.isArray(form.owner_targets) ? form.owner_targets : []
    if (ownerTargets.length < 1) {
      toast.error('At least one owner is required')
      return
    }
    const firstOwner = ownerTargets[0] || null
    const payload = {
      ...form,
      owner_id: firstOwner?.type === 'user' ? firstOwner.id : undefined,
      owner_type: firstOwner?.type || 'user',
      owner_group_id: firstOwner?.type === 'local_group' ? firstOwner.id : undefined,
      owner_ldap_dn: ['ldap_user', 'ldap_group'].includes(firstOwner?.type) ? firstOwner.dn : undefined,
      owner_ldap_name: ['ldap_user', 'ldap_group'].includes(firstOwner?.type) ? firstOwner.name : undefined,
      user_targets: Array.isArray(form.user_targets) ? form.user_targets : [],
    }
    try {
      await assetsApi.update(editTarget.id, payload)
      await assetsApi.updateLicenses(editTarget.id, editLicenseIds).catch(() => {})
      const toAdd = editDepIds.filter(id => !editOrigDepIds.includes(id))
      const toRemove = editOrigDepIds.filter(id => !editDepIds.includes(id))
      for (const depId of toAdd) await assetsApi.addDependency(editTarget.id, depId).catch(() => {})
      for (const depId of toRemove) await assetsApi.removeDependency(editTarget.id, depId).catch(() => {})
      toast.success('Asset updated')
      setEditTarget(null)
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const toggleAssetSelection = (id) => {
    if (!canBulkDelete) return
    setSelectedAssetIds((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleSelectAllVisible = (checked) => {
    if (!canBulkDelete) return
    if (checked) {
      setSelectedAssetIds(assets.map(a => a.id))
      return
    }
    setSelectedAssetIds([])
  }

  const handleBulkDelete = async () => {
    if (!canBulkDelete || selectedAssetIds.length === 0) return
    setBulkDeleting(true)
    try {
      const results = await Promise.allSettled(selectedAssetIds.map((id) => assetsApi.delete(id)))
      const ok = results.filter(r => r.status === 'fulfilled').length
      const ko = results.length - ok
      if (ok > 0) toast.success(`${ok} asset deleted`)
      if (ko > 0) toast.error(`${ko} asset not deleted`)
      setConfirmBulkDelete(false)
      setSelectedAssetIds([])
      load()
    } finally {
      setBulkDeleting(false)
    }
  }

  const allVisibleSelected = assets.length > 0 && assets.every(a => selectedAssetIds.includes(a.id))

  return (
    <Layout title="Assets">
      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex gap-2 flex-wrap">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
              <input className="input pl-9 w-48" placeholder="Search..." value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }} />
            </div>
            <select className="input w-40" value={filterCrit} onChange={e => { setFilterCrit(e.target.value); setPage(1) }}>
              <option value="">All criticalities</option>
              {CRITICALITIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={load}><RefreshCw size={15} /></button>
            {canBulkDelete && (
              <button
                className="btn-danger"
                disabled={selectedAssetIds.length === 0 || bulkDeleting}
                onClick={() => setConfirmBulkDelete(true)}
              >
                <Trash2 size={15} />Delete selected ({selectedAssetIds.length})
              </button>
            )}
            {canEdit && <Link to="/assets/categories" className="btn-secondary">Asset Categories</Link>}
            {canEdit && <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />New Asset</button>}
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  {canBulkDelete && (
                    <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300 w-10">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={(e) => toggleSelectAllVisible(e.target.checked)}
                        aria-label="Select all visible assets"
                      />
                    </th>
                  )}
                  {['Name','Category','Criticality','Status','Licenses','Probe','Owner',''].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading ? (
                  <tr><td colSpan={canBulkDelete ? 9 : 8} className="text-center py-8 text-gray-500">Loading...</td></tr>
                ) : assets.map(a => (
                  <tr
                    key={a.id}
                    className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${canEdit ? 'cursor-pointer' : ''}`}
                    onDoubleClick={canEdit ? () => openEdit(a) : undefined}
                    title={canEdit ? 'Double click to edit' : undefined}
                  >
                    {canBulkDelete && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedAssetIds.includes(a.id)}
                          onChange={() => toggleAssetSelection(a.id)}
                          aria-label={`Select asset ${a.name}`}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 font-medium">
                      <Link to={`/assets/${a.id}`} className="text-brand-600 hover:underline">{a.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: (categories.find(c => c.slug === a.category) || {}).color || '#6b7280' }} />
                        {a.category}
                      </span>
                    </td>
                    <td className="px-4 py-3"><CriticalityBadge criticality={a.criticality} /></td>
                    <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                    <td className="px-4 py-3"><LicenseState row={a} /></td>
                    <td className="px-4 py-3 text-gray-500"><ProbeState row={a} /></td>
                    <td className="px-4 py-3 text-sm text-gray-600">{(a.owner_label || a.owner_name || '—')}{(a.owner_count || 0) > 1 ? ` +${a.owner_count - 1}` : ''}</td>
                    <td className="px-4 py-3">
                      {canEdit && (
                        <button onClick={() => openEdit(a)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-400 hover:text-brand-600 transition-colors">
                          <Pencil size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4">
            <Pagination page={page} limit={limit} total={total} onChange={setPage} onLimitChange={setLimit} />
          </div>
        </div>
      </div>

      {/* Create modal */}
      {showCreate && (
        <Modal title="New Asset" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {(categories.length ? categories : CATEGORIES.map(s => ({ slug: s, label: s }))).map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Criticality</label>
                <select className="input" value={form.criticality} onChange={e => setForm(f => ({ ...f, criticality: e.target.value }))}>
                  {CRITICALITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <label className="flex items-start gap-2 text-sm p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
              <input type="checkbox" className="mt-0.5" checked={form.part_is_relevant === true} onChange={e => setForm(f => ({ ...f, part_is_relevant: e.target.checked }))} />
              <span>
                <span className="font-medium text-amber-800 dark:text-amber-300">Part-IS Relevant</span>
                <span className="block text-xs text-amber-700 dark:text-amber-400 mt-0.5">Maintenance on this asset will require every owner's email approval before it can start.</span>
              </span>
            </label>
            {ownerFieldsJsx}
            {usersFieldsJsx}

            <ItemPicker
              label="Assigned licenses"
              allItems={allLicenses}
              selectedIds={createLicenseIds}
              onToggle={id => setCreateLicenseIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])}
              nameKey="name"
              badgeKey="supplier_name"
              useModal
              maxResults={120}
            />
            <ItemPicker
              label="Depends on (assets)"
              allItems={assets.filter(a => a.id !== editTarget?.id)}
              selectedIds={createDepIds}
              onToggle={id => setCreateDepIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])}
              badgeKey="category"
              useModal
              filterKey="category"
              maxResults={120}
            />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Create</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {editTarget && (
        <Modal title={`Edit Asset: ${editTarget.name}`} onClose={() => setEditTarget(null)}>
          <form onSubmit={handleEdit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                <select className="input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {(categories.length ? categories : CATEGORIES.map(s => ({ slug: s, label: s }))).map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Criticality</label>
                <select className="input" value={form.criticality} onChange={e => setForm(f => ({ ...f, criticality: e.target.value }))}>
                  {CRITICALITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <label className="flex items-start gap-2 text-sm p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
              <input type="checkbox" className="mt-0.5" checked={form.part_is_relevant === true} onChange={e => setForm(f => ({ ...f, part_is_relevant: e.target.checked }))} />
              <span>
                <span className="font-medium text-amber-800 dark:text-amber-300">Part-IS Relevant</span>
                <span className="block text-xs text-amber-700 dark:text-amber-400 mt-0.5">Maintenance on this asset will require every owner's email approval before it can start.</span>
              </span>
            </label>
            {ownerFieldsJsx}
            {usersFieldsJsx}

            <ItemPicker
              label="Assigned licenses"
              allItems={allLicenses}
              selectedIds={editLicenseIds}
              onToggle={id => setEditLicenseIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])}
              nameKey="name"
              badgeKey="supplier_name"
              useModal
              maxResults={120}
            />
            <ItemPicker
              label="Depends on (assets)"
              allItems={assets.filter(a => a.id !== editTarget?.id)}
              selectedIds={editDepIds}
              onToggle={id => setEditDepIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])}
              badgeKey="category"
              useModal
              filterKey="category"
              maxResults={120}
            />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}

      <OwnerPickerModal
        open={ownerPickerOpen}
        onClose={() => setOwnerPickerOpen(false)}
        value={pickerTarget === 'owner' ? (form.owner_targets || []) : (form.user_targets || [])}
        onChange={(owners) => setForm(f => pickerTarget === 'owner' ? ({ ...f, owner_targets: owners }) : ({ ...f, user_targets: owners }))}
        users={users}
        localGroups={localGroups}
        ldapEnabled={ldapEnabled}
      />

      {confirmBulkDelete && (
        <ConfirmDialog
          title="Delete Selected Assets"
          message={`Delete ${selectedAssetIds.length} selected asset(s)? This action cannot be undone.`}
          danger
          confirmLabel={bulkDeleting ? 'Deleting...' : 'Delete'}
          onConfirm={handleBulkDelete}
          onCancel={() => !bulkDeleting && setConfirmBulkDelete(false)}
        />
      )}
    </Layout>
  )
}
