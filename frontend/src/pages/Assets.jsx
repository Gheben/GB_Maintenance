import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { Modal } from '../components/Modal'
import { ItemPicker } from '../components/ItemPicker'
import { OwnerPickerModal } from '../components/OwnerPickerModal'
import { toast } from '../components/Toast'
import { assetsApi, assetCategoriesApi, usersApi, groupsApi, settingsApi, licensesApi } from '../api'
import { Plus, Search, RefreshCw, Pencil } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const CATEGORIES = ['application','infrastructure','database','network','hardware','api','other']
const CRITICALITIES = ['critical','high','medium','low']

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

export default function Assets() {
  const { hasPermission } = useAuth()
  const canEdit = hasPermission('assets')
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
  const [form, setForm] = useState({ name: '', category: 'application', criticality: 'medium', description: '', owner_targets: [] })
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false)
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

  const load = useCallback(() => {
    setLoading(true)
    assetsApi.list({ search, criticality: filterCrit, status: filterStatus, page, limit })
      .then(r => { setAssets(r.data.data); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }, [search, filterCrit, filterStatus, page, limit])

  useEffect(() => { load() }, [load])
  useEffect(() => { assetCategoriesApi.list().then(r => setCategories(r.data)).catch(() => setCategories(CATEGORIES.map(s => ({ slug: s, label: s, color: '#6366f1' })))) }, [])

  useEffect(() => {
    usersApi.list({ limit: 200 }).then(r => setUsers(Array.isArray(r.data) ? r.data : (r.data.data || []))).catch(() => {})
    groupsApi.list().then(r => setLocalGroups(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    settingsApi.getLdap().then(r => setLdapEnabled(!!(r.data?.enabled))).catch(() => {})
    licensesApi.list({ limit: 500 }).then(r => {
      const rows = Array.isArray(r.data) ? r.data : (r.data.data || [])
      setAllLicenses(rows)
    }).catch(() => {})
  }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    const ownerTargets = Array.isArray(form.owner_targets) ? form.owner_targets : []
    const firstOwner = ownerTargets[0] || null
    const payload = {
      ...form,
      owner_id: firstOwner?.type === 'user' ? firstOwner.id : undefined,
      owner_type: firstOwner?.type || 'user',
      owner_group_id: firstOwner?.type === 'local_group' ? firstOwner.id : undefined,
      owner_ldap_dn: ['ldap_user', 'ldap_group'].includes(firstOwner?.type) ? firstOwner.dn : undefined,
      owner_ldap_name: ['ldap_user', 'ldap_group'].includes(firstOwner?.type) ? firstOwner.name : undefined,
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
      setForm({ name: '', category: 'application', criticality: 'medium', description: '', owner_targets: [] })
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
      owner_targets: ownerTargets,
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
      <label className="block text-sm font-medium mb-1">Owner</label>
      <div className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
        <div className="text-xs text-gray-600 dark:text-gray-300">
          {form.owner_targets?.length > 0 ? `${form.owner_targets.length} owner(s) selected` : 'No owners selected'}
        </div>
        <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" onClick={() => setOwnerPickerOpen(true)}>
          Select owners
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

  const handleEdit = async (e) => {
    e.preventDefault()
    const ownerTargets = Array.isArray(form.owner_targets) ? form.owner_targets : []
    const firstOwner = ownerTargets[0] || null
    const payload = {
      ...form,
      owner_id: firstOwner?.type === 'user' ? firstOwner.id : undefined,
      owner_type: firstOwner?.type || 'user',
      owner_group_id: firstOwner?.type === 'local_group' ? firstOwner.id : undefined,
      owner_ldap_dn: ['ldap_user', 'ldap_group'].includes(firstOwner?.type) ? firstOwner.dn : undefined,
      owner_ldap_name: ['ldap_user', 'ldap_group'].includes(firstOwner?.type) ? firstOwner.name : undefined,
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
              {canEdit && <Link to="/assets/categories" className="btn-secondary">Asset Categories</Link>}
            {canEdit && <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />New Asset</button>}
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>{['Name','Category','Criticality','Status','Licenses','Probe',''].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-gray-500">Loading...</td></tr>
                ) : assets.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
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
                    <td className="px-4 py-3 text-gray-500">{a.probe_enabled ? a.probe_type : '—'}</td>
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
            {ownerFieldsJsx}
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
            {ownerFieldsJsx}
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
        value={form.owner_targets || []}
        onChange={(owners) => setForm(f => ({ ...f, owner_targets: owners }))}
        users={users}
        localGroups={localGroups}
        ldapEnabled={ldapEnabled}
      />
    </Layout>
  )
}
