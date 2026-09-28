import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { ConfirmDialog, Modal } from '../components/Modal'
import { ItemPicker } from '../components/ItemPicker'
import { OwnerPickerModal } from '../components/OwnerPickerModal'
import { toast } from '../components/Toast'
import { servicesApi, usersApi, groupsApi, settingsApi, licensesApi } from '../api'
import { Plus, Search, RefreshCw, Pencil, Trash2, Globe, ShieldCheck } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const BLANK_FORM = { name: '', description: '', criticality: 'medium', sla_uptime_percent: 99.9, is_public: false, part_is_relevant: false, owner_targets: [], user_targets: [], system_name: '' }

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

export default function Services() {
  const { hasPermission, hasRole } = useAuth()
  const canEdit = hasPermission('services')
  const canBulkDelete = hasRole('superadmin', 'admin')
  const [services, setServices] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState('owner')
  const [users, setUsers] = useState([])
  const [localGroups, setLocalGroups] = useState([])
  const [ldapEnabled, setLdapEnabled] = useState(false)
  const [form, setForm] = useState(BLANK_FORM)
  const [createDepIds, setCreateDepIds] = useState([])
  const [editDepIds, setEditDepIds] = useState([])
  const [editOrigDepIds, setEditOrigDepIds] = useState([])
  const [allLicenses, setAllLicenses] = useState([])
  const [createLicenseIds, setCreateLicenseIds] = useState([])
  const [editLicenseIds, setEditLicenseIds] = useState([])
  const [selectedServiceIds, setSelectedServiceIds] = useState([])
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    servicesApi.list({ search, page, limit })
      .then(r => { setServices(r.data.data); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }, [search, page, limit])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    setSelectedServiceIds(prev => prev.filter(id => services.some(s => s.id === id)))
  }, [services])

  useEffect(() => {
    usersApi.assignable({ limit: 200 }).then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data.data || [])
      setUsers(list)
    }).catch(() => {})
    groupsApi.assignable().then(r => {
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
      system_name: form.system_name || undefined,
    }
    try {
      const res = await servicesApi.create(payload)
      const newId = res.data?.id
      if (newId) {
        await servicesApi.updateLicenses(newId, createLicenseIds).catch(() => {})
        for (const depId of createDepIds) {
          await servicesApi.addDependency(newId, depId).catch(() => {})
        }
      }
      toast.success('Service created')
      setShowCreate(false)
      setForm(BLANK_FORM)
      setCreateDepIds([])
      setCreateLicenseIds([])
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const openEdit = async (s) => {
    setEditTarget(s)
    const ownerTargets = Array.isArray(s.owner_targets) && s.owner_targets.length > 0
      ? s.owner_targets
      : (() => {
        if (s.owner_type === 'user' && s.owner_id) return [{ type: 'user', id: s.owner_id, name: s.owner_name || s.owner_label || 'User', email: s.owner_email || '' }]
        if (s.owner_type === 'local_group' && s.owner_group_id) return [{ type: 'local_group', id: s.owner_group_id, name: s.owner_group_name || s.owner_label || 'Group' }]
        if (['ldap_user', 'ldap_group'].includes(s.owner_type) && s.owner_ldap_dn) return [{ type: s.owner_type, dn: s.owner_ldap_dn, name: s.owner_ldap_name || s.owner_ldap_dn }]
        return []
      })()
    setForm({
      name: s.name, description: s.description || '', criticality: s.criticality,
      sla_uptime_percent: s.sla_uptime_percent, is_public: s.is_public, part_is_relevant: s.part_is_relevant === true,
      owner_targets: ownerTargets,
      user_targets: Array.isArray(s.user_targets) ? s.user_targets : [],
      system_name: s.system_name || ''
    })
    try {
      const r = await servicesApi.get(s.id)
      const depIds = (r.data.depends_on || []).map(d => d.id)
      setEditDepIds(depIds)
      setEditOrigDepIds(depIds)
      const lr = await servicesApi.licenses(s.id)
      const rows = Array.isArray(lr.data) ? lr.data : []
      setAllLicenses(rows)
      setEditLicenseIds(rows.filter(l => l.assigned).map(l => l.id))
    } catch {
      setEditDepIds([])
      setEditOrigDepIds([])
      setEditLicenseIds([])
    }
  }

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
      system_name: form.system_name || undefined,
    }
    try {
      await servicesApi.update(editTarget.id, payload)
      await servicesApi.updateLicenses(editTarget.id, editLicenseIds).catch(() => {})
      const toAdd = editDepIds.filter(id => !editOrigDepIds.includes(id))
      const toRemove = editOrigDepIds.filter(id => !editDepIds.includes(id))
      for (const depId of toAdd) await servicesApi.addDependency(editTarget.id, depId).catch(() => {})
      for (const depId of toRemove) await servicesApi.removeDependency(editTarget.id, depId).catch(() => {})
      toast.success('Service updated')
      setEditTarget(null)
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
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

  const serviceFormBody = (onSubmit, onClose, submitLabel, extraContent = null) => (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Name *</label>
        <input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">System / Group</label>
          <input className="input" placeholder="e.g. ERP, Network, Cloud" value={form.system_name} onChange={e => setForm(f => ({ ...f, system_name: e.target.value }))} />
        </div>
        {ownerFieldsJsx}
      </div>
      {usersFieldsJsx}
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
        <input type="checkbox" id="svc-public" checked={form.is_public} onChange={e => setForm(f => ({ ...f, is_public: e.target.checked }))} />
        <label htmlFor="svc-public" className="text-sm">Visible on public status page</label>
      </div>
      <label className="flex items-start gap-2 text-sm p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
        <input type="checkbox" className="mt-0.5" checked={form.part_is_relevant === true} onChange={e => setForm(f => ({ ...f, part_is_relevant: e.target.checked }))} />
        <span>
          <span className="font-medium text-amber-800 dark:text-amber-300">Part-IS Relevant</span>
          <span className="block text-xs text-amber-700 dark:text-amber-400 mt-0.5">Maintenance on this service will require every owner's email approval before it can start.</span>
        </span>
      </label>
      <ItemPicker
        label="Assigned licenses"
        allItems={allLicenses}
        selectedIds={editTarget ? editLicenseIds : createLicenseIds}
        onToggle={id => {
          if (editTarget) setEditLicenseIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])
          else setCreateLicenseIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])
        }}
        nameKey="name"
        badgeKey="supplier_name"
        useModal
        maxResults={120}
        onSearch={(q) => licensesApi.list({ q, limit: 50 }).then(r => Array.isArray(r.data) ? r.data : (r.data.data || []))}
      />
      {extraContent}
      <div className="flex justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary">{submitLabel}</button>
      </div>
    </form>
  )

  const toggleServiceSelection = (id) => {
    if (!canBulkDelete) return
    setSelectedServiceIds((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleSelectAllVisible = (checked) => {
    if (!canBulkDelete) return
    if (checked) {
      setSelectedServiceIds(services.map(s => s.id))
      return
    }
    setSelectedServiceIds([])
  }

  const handleBulkDelete = async () => {
    if (!canBulkDelete || selectedServiceIds.length === 0) return
    setBulkDeleting(true)
    try {
      const results = await Promise.allSettled(selectedServiceIds.map((id) => servicesApi.delete(id)))
      const ok = results.filter(r => r.status === 'fulfilled').length
      const ko = results.length - ok
      if (ok > 0) toast.success(`${ok} service deleted`)
      if (ko > 0) toast.error(`${ko} service not deleted`)
      setConfirmBulkDelete(false)
      setSelectedServiceIds([])
      load()
    } finally {
      setBulkDeleting(false)
    }
  }

  const allVisibleSelected = services.length > 0 && services.every(s => selectedServiceIds.includes(s.id))

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
            {canBulkDelete && (
              <button
                className="btn-danger"
                disabled={selectedServiceIds.length === 0 || bulkDeleting}
                onClick={() => setConfirmBulkDelete(true)}
              >
                <Trash2 size={15} />Delete selected ({selectedServiceIds.length})
              </button>
            )}
            {canEdit && <button className="btn-primary" onClick={() => { setForm(BLANK_FORM); setShowCreate(true) }}><Plus size={15} />New Service</button>}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[640px] w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  {canBulkDelete && (
                    <th className="text-left px-4 py-3 font-medium text-gray-600 w-10">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={(e) => toggleSelectAllVisible(e.target.checked)}
                        aria-label="Select all visible services"
                      />
                    </th>
                  )}
                  {['Name','Criticality','Status','Assets','Licenses','Probes','Owner',''].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading ? <tr><td colSpan={canBulkDelete ? 9 : 8} className="text-center py-8 text-gray-500">Loading...</td></tr>
                  : services.map(s => (
                    <tr
                      key={s.id}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${canEdit ? 'cursor-pointer' : ''}`}
                      onDoubleClick={canEdit ? () => openEdit(s) : undefined}
                      title={canEdit ? 'Double click to edit' : undefined}
                    >
                      {canBulkDelete && (
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedServiceIds.includes(s.id)}
                            onChange={() => toggleServiceSelection(s.id)}
                            aria-label={`Select service ${s.name}`}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 font-medium">
                        <Link to={`/services/${s.id}`} className="text-brand-600 hover:underline flex items-center gap-1.5">
                          {s.is_public && <Globe size={13} className="text-green-500 flex-shrink-0" />}
                          {s.part_is_relevant && <ShieldCheck size={13} className="text-amber-600 flex-shrink-0" title="Part-IS Relevant" />}
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3"><CriticalityBadge criticality={s.criticality} /></td>
                      <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                      <td className="px-4 py-3 text-gray-500">{s.asset_count ?? 0}</td>
                      <td className="px-4 py-3"><LicenseState row={s} /></td>
                      <td className="px-4 py-3 text-gray-500"><ProbeState row={s} /></td>
                      <td className="px-4 py-3 text-sm text-gray-600">{(s.owner_label || s.owner_name || '—')}{(s.owner_count || 0) > 1 ? ` +${s.owner_count - 1}` : ''}</td>
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
          <div className="p-4"><Pagination page={page} limit={limit} total={total} onChange={setPage} onLimitChange={setLimit} /></div>
        </div>
      </div>

      {showCreate && (
        <Modal title="New Service" onClose={() => setShowCreate(false)}>
          {serviceFormBody(handleCreate, () => setShowCreate(false), 'Create',
            <ItemPicker
              label="Depends on (services)"
              allItems={services}
              selectedIds={createDepIds}
              onToggle={id => setCreateDepIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])}
              useModal
              maxResults={120}
              onSearch={(q) => servicesApi.list({ search: q, limit: 50 }).then(r => Array.isArray(r.data) ? r.data : (r.data.data || []))}
            />
          )}
        </Modal>
      )}
      {editTarget && (
        <Modal title={`Edit Service: ${editTarget.name}`} onClose={() => setEditTarget(null)}>
          {serviceFormBody(handleEdit, () => setEditTarget(null), 'Save',
            <ItemPicker
              label="Depends on (services)"
              allItems={services.filter(s => s.id !== editTarget?.id)}
              selectedIds={editDepIds}
              onToggle={id => setEditDepIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])}
              useModal
              maxResults={120}
              onSearch={(q) => servicesApi.list({ search: q, limit: 50 }).then(r => (Array.isArray(r.data) ? r.data : (r.data.data || [])).filter(s => s.id !== editTarget?.id))}
            />
          )}
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
        onSearchUsers={(q) => usersApi.assignable({ q, limit: 50 }).then(r => r.data)}
        onSearchGroups={(q) => groupsApi.assignable({ q }).then(r => r.data)}
      />

      {confirmBulkDelete && (
        <ConfirmDialog
          title="Delete Selected Services"
          message={`Delete ${selectedServiceIds.length} selected service(s)? This action cannot be undone.`}
          danger
          confirmLabel={bulkDeleting ? 'Deleting...' : 'Delete'}
          onConfirm={handleBulkDelete}
          onCancel={() => !bulkDeleting && setConfirmBulkDelete(false)}
        />
      )}
    </Layout>
  )
}
