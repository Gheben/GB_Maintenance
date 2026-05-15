import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { Modal } from '../components/Modal'
import { ItemPicker } from '../components/ItemPicker'
import { OwnerPickerModal } from '../components/OwnerPickerModal'
import { toast } from '../components/Toast'
import { servicesApi, usersApi, groupsApi, settingsApi, licensesApi } from '../api'
import { Plus, Search, RefreshCw, Pencil } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const BLANK_FORM = { name: '', description: '', criticality: 'medium', sla_uptime_percent: 99.9, is_public: false, owner_targets: [], user_targets: [], system_name: '' }

function LicenseState({ row }) {
  const total = Number(row.license_count || 0)
  const expired = Number(row.expired_license_count || 0)
  const next = row.next_license_expiry ? new Date(row.next_license_expiry) : null

  if (!total) return <span className="text-gray-400">—</span>

  let badge = <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Active</span>
  if (expired > 0) badge = <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Expired</span>
  if (next && !Number.isNaN(next.getTime())) {
    const days = Math.ceil((next.getTime() - Date.now()) / 86400000)
    const date = next.toISOString().slice(0, 10)
    if (days <= 30) badge = <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Expiring {date}</span>
    else badge = <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Valid {date}</span>
  }

  return (
    <div className="space-y-0.5">
      <div>{badge}</div>
      {row.primary_license_name && <div className="text-[11px] text-gray-500 leading-tight">{row.primary_license_name}</div>}
      {row.primary_supplier_name && <div className="text-[11px] text-gray-400 leading-tight">{row.primary_supplier_name}</div>}
    </div>
  )
}

export default function Services() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('services')
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

  const load = useCallback(() => {
    setLoading(true)
    servicesApi.list({ search, page, limit })
      .then(r => { setServices(r.data.data); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }, [search, page, limit])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    usersApi.list({ limit: 200 }).then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data.data || [])
      setUsers(list)
    }).catch(() => {})
    groupsApi.list().then(r => {
      const rows = Array.isArray(r.data) ? r.data : []
      setLocalGroups(rows.map(g => ({
        ...g,
        type: Number(g.ldap_mapping_count || 0) > 0 ? 'ldap_group' : 'local_group',
      })))
    }).catch(() => {})
    settingsApi.getLdap().then(r => setLdapEnabled(!!(r.data?.enabled))).catch(() => {})
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
      sla_uptime_percent: s.sla_uptime_percent, is_public: s.is_public,
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
      />
      {extraContent}
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
                <tr>{['Name','System','Criticality','Status','Licenses','Owner','Assets','SLA %','Public',''].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading ? <tr><td colSpan={10} className="text-center py-8 text-gray-500">Loading...</td></tr>
                  : services.map(s => (
                    <tr
                      key={s.id}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${canEdit ? 'cursor-pointer' : ''}`}
                      onDoubleClick={canEdit ? () => openEdit(s) : undefined}
                      title={canEdit ? 'Double click to edit' : undefined}
                    >
                      <td className="px-4 py-3 font-medium">
                        <Link to={`/services/${s.id}`} className="text-brand-600 hover:underline">{s.name}</Link>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{s.system_name ? <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 font-medium">{s.system_name}</span> : '—'}</td>
                      <td className="px-4 py-3"><CriticalityBadge criticality={s.criticality} /></td>
                      <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                      <td className="px-4 py-3"><LicenseState row={s} /></td>
                      <td className="px-4 py-3 text-sm text-gray-600">{(s.owner_label || s.owner_name || '—')}{(s.owner_count || 0) > 1 ? ` +${s.owner_count - 1}` : ''}</td>
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
      />
    </Layout>
  )
}
