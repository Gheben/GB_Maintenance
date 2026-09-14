import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { ConfirmDialog, Modal } from '../components/Modal'
import { OwnerPickerModal } from '../components/OwnerPickerModal'
import { toast } from '../components/Toast'
import { servicesApi, usersApi, groupsApi, settingsApi, maintenanceApi } from '../api'
import CorrelationGraphLoader from '../components/CorrelationGraphLoader'
import { format } from 'date-fns'
import { Trash2, ArrowLeft, Pencil, Save, X, Plus, ExternalLink, User, Mail, Cog, Building2, Search, Play, Info } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const CRITICALITIES = ['critical','high','medium','low']
const TABS = [['info','Info'],['deps','Dependencies'],['assets','Linked Assets'],['licenses','Licenses'],['probes','Probes'],['maintenance','Maintenance'],['correlations','Correlations'],['users','Users']]

function approvalStatusMeta(status) {
  if (status === 'approved') return { label: 'Approved', cls: 'bg-green-100 text-green-700' }
  if (status === 'rejected') return { label: 'Rejected', cls: 'bg-red-100 text-red-700' }
  return { label: 'Pending', cls: 'bg-amber-100 text-amber-700' }
}

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

function ProbeFavicon({ probeType, probeUrl }) {
  if (!probeUrl || !['http', 'https', 'tls'].includes(probeType)) return null
  let host = ''
  try {
    if (probeType === 'tls') {
      host = probeUrl.split(':')[0]
    } else {
      const u = probeUrl.startsWith('http') ? probeUrl : `https://${probeUrl}`
      host = new URL(u).hostname
    }
    if (!host) return null
  } catch { return null }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      alt=""
      width={20} height={20}
      className="w-5 h-5 rounded-sm object-contain flex-shrink-0"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={e => { e.target.style.display = 'none' }}
    />
  )
}

export default function ServiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const [service, setService] = useState(null)
  const [maintenance, setMaintenance] = useState([])
  const [maintenancePage, setMaintenancePage] = useState(1)
  const [maintenanceTotal, setMaintenanceTotal] = useState(0)
  const [maintenanceDetailOpen, setMaintenanceDetailOpen] = useState(false)
  const [maintenanceDetail, setMaintenanceDetail] = useState(null)
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
  const [serviceUsers, setServiceUsers] = useState([])
  
  // Owner states
  const [ownerUsers, setOwnerUsers] = useState([])
  const [localGroups, setLocalGroups] = useState([])
  const [ldapEnabled, setLdapEnabled] = useState(false)
  const [licenseRows, setLicenseRows] = useState([])
  const [savingLicenses, setSavingLicenses] = useState(false)
  const [licensePickerOpen, setLicensePickerOpen] = useState(false)
  const [licenseSearch, setLicenseSearch] = useState('')
  const [licenseRemoveTarget, setLicenseRemoveTarget] = useState(null)
  const [usersModalOpen, setUsersModalOpen] = useState(false)
  const [officesModalOpen, setOfficesModalOpen] = useState(false)
  const [officeSearch, setOfficeSearch] = useState('')

  // Probe states
  const [probeConfigs, setProbeConfigs] = useState([])
  const [probes, setProbes] = useState([])
  const [probeForm, setProbeForm] = useState(null)
  const [probeConfigOpen, setProbeConfigOpen] = useState(false)
  const [editingProbeId, setEditingProbeId] = useState(null)
  const [probing, setProbing] = useState(false)
  const [probingProbeId, setProbingProbeId] = useState(null)
  const [savingProbe, setSavingProbe] = useState(false)
  const [probeHistoryOpen, setProbeHistoryOpen] = useState(false)
  const [probeHistoryForProbeId, setProbeHistoryForProbeId] = useState(null)
  const [probeDetails, setProbeDetails] = useState(null)
  const [probeDeleteTarget, setProbeDeleteTarget] = useState(null)

  const loadMaintenance = async (pageNum = 1) => {
    try {
      const r = await servicesApi.maintenance(id, { page: pageNum, limit: 25 })
      const payload = r.data?.data ? r.data : { data: Array.isArray(r.data) ? r.data : [], total: Array.isArray(r.data) ? r.data.length : 0, page: pageNum, limit: 25 }
      setMaintenance(payload.data || [])
      setMaintenanceTotal(payload.total || 0)
      setMaintenancePage(payload.page || pageNum)
    } catch {
      setMaintenance([])
      setMaintenanceTotal(0)
    }
  }

  const load = () => {
    servicesApi.get(id).then(r => setService(r.data)).catch(() => navigate('/services'))
    loadMaintenance(1)
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
    if (tab === 'probes') {
      servicesApi.probeConfigs(id).then(r => setProbeConfigs(Array.isArray(r.data) ? r.data : [])).catch(() => setProbeConfigs([]))
      servicesApi.probes(id, { limit: 200 }).then(r => setProbes(Array.isArray(r.data) ? r.data : [])).catch(() => setProbes([]))
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
    settingsApi.getLdapEnabled().then(r => setLdapEnabled(r.data?.enabled || false)).catch(() => {})
  }

  const saveLicenses = async () => {
    if (!editMode || !canEdit) return
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

  const confirmRemoveLicense = () => {
    if (!licenseRemoveTarget) return
    setLicenseRows((rows) => rows.map((x) => x.id === licenseRemoveTarget.id ? { ...x, assigned: false } : x))
    setLicenseRemoveTarget(null)
  }

  const handleProbeNow = async () => {
    setProbing(true)
    try {
      await servicesApi.probeNow(id)
      toast.success('Probe started')
      const r = await servicesApi.probes(id, { limit: 200 })
      setProbes(r.data)
      const sr = await servicesApi.get(id)
      setService(sr.data)
    } catch (err) { toast.error('Probe error') }
    finally { setProbing(false) }
  }

  const handleProbeNowById = async (probeId) => {
    setProbingProbeId(probeId)
    try {
      await servicesApi.probeNowById(id, probeId)
      toast.success('Probe running')
      const r = await servicesApi.probes(id, { limit: 200 })
      setProbes(r.data)
      const sr = await servicesApi.get(id)
      setService(sr.data)
    } catch (err) { toast.error('Probe error') }
    finally { setProbingProbeId(null) }
  }

  const openAdditionalProbeConfig = (probe = null) => {
    setEditingProbeId(probe?.id || null)
    setProbeForm({
      name: probe?.name || '',
      probe_type: probe?.probe_type || 'https',
      probe_url: probe?.probe_target || '',
      probe_interval_seconds: probe?.probe_interval_seconds ?? 300,
      probe_timeout_seconds: probe?.probe_timeout_seconds ?? 10,
      expected_status_code: probe?.expected_status_code ?? 200,
      failure_threshold: probe?.failure_threshold ?? 2,
      recovery_threshold: probe?.recovery_threshold ?? 2,
      pause_during_maintenance: probe ? probe.pause_during_maintenance !== false : true,
      dns_record_type: probe?.dns_record_type || 'A',
      dns_expected_value: probe?.dns_expected_value || '',
      ssl_expiry_warning_days: probe?.ssl_expiry_warning_days ?? 30,
    })
    setProbeConfigOpen(true)
  }

  const saveProbeConfig = async () => {
    if (!probeForm) return
    if (!probeForm.probe_url || probeForm.probe_url.trim() === '') {
      toast.error('Probe target URL is required')
      return
    }
    setSavingProbe(true)
    try {
      const payload = {
        name: probeForm.name || null,
        probe_enabled: true,
        probe_type: probeForm.probe_type,
        probe_target: probeForm.probe_url.trim(),
        probe_interval_seconds: Number(probeForm.probe_interval_seconds) || 300,
        probe_timeout_seconds: Number(probeForm.probe_timeout_seconds) || 10,
        expected_status_code: Number(probeForm.expected_status_code) || 200,
        failure_threshold: Number(probeForm.failure_threshold) || 2,
        recovery_threshold: Number(probeForm.recovery_threshold) || 2,
        pause_during_maintenance: !!probeForm.pause_during_maintenance,
        dns_record_type: probeForm.dns_record_type || 'A',
        dns_expected_value: probeForm.dns_expected_value || null,
        ssl_expiry_warning_days: Number(probeForm.ssl_expiry_warning_days) || 30,
      }
      if (editingProbeId) {
        await servicesApi.updateProbeConfig(id, editingProbeId, payload)
      } else {
        await servicesApi.createProbeConfig(id, payload)
      }
      toast.success('Probe configuration saved')
      setProbeConfigOpen(false)
      setEditingProbeId(null)
      const r = await servicesApi.probeConfigs(id)
      setProbeConfigs(Array.isArray(r.data) ? r.data : [])
    } catch (err) {
      const errData = err.response?.data
      const msg = errData?.error || errData?.errors?.[0]?.msg || 'Error saving probe config'
      toast.error(msg)
      console.error('[ProbeConfig] save error:', errData)
    }
    finally { setSavingProbe(false) }
  }

  const deleteProbeConfig = async (probeId) => {
    try {
      await servicesApi.deleteProbeConfig(id, probeId)
      toast.success('Probe removed')
      const r = await servicesApi.probeConfigs(id)
      setProbeConfigs(Array.isArray(r.data) ? r.data : [])
      setProbeDeleteTarget(null)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error removing probe')
    }
  }

  const openProbeDetails = (probe) => setProbeDetails(probe)

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
    return matchesSearch
  })
  const impactedOffices = [...new Set(serviceUsers.map((u) => String(u.office || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const assignedLicenseRows = licenseRows.filter((l) => !!l.assigned)
  const availableLicenseRows = licenseRows.filter((l) => !l.assigned)
  const filteredAvailableLicenseRows = availableLicenseRows.filter((l) => {
    const q = String(licenseSearch || '').trim().toLowerCase()
    if (!q) return true
    return String(l.name || '').toLowerCase().includes(q)
      || String(l.approval_status || '').toLowerCase().includes(q)
      || String(l.supplier_name || '').toLowerCase().includes(q)
  })

  const openMaintenanceDetail = async (maintenanceId) => {
    try {
      const r = await maintenanceApi.get(maintenanceId)
      setMaintenanceDetail(r.data)
      setMaintenanceDetailOpen(true)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Cannot load maintenance detail')
    }
  }

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
            {impactedOffices.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">Offices involved</span>
                  <span className="text-xs text-gray-500">{impactedOffices.length} office(s)</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {impactedOffices.map((office) => (
                    <span key={office} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                      {office}
                    </span>
                  ))}
                </div>
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

        {/* Probes tab */}
        {tab === 'probes' && (
          <div className="space-y-4">
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Probe configurations ({probeConfigs.length})</span>
                <div className="flex items-center gap-2">
                  {probeConfigs.length === 1 && probeConfigs[0].probe_enabled && (
                    <button className="btn-secondary text-xs flex items-center gap-1" disabled={probing} onClick={handleProbeNow}>
                      <Play size={12} />{probing ? 'Probing...' : 'Run Now'}
                    </button>
                  )}
                  {canEdit && editMode && (
                    <button className="btn-primary text-xs" onClick={() => openAdditionalProbeConfig(null)}>Add probe</button>
                  )}
                </div>
              </div>
              {probeConfigs.length === 0 && <p className="text-sm text-gray-500">No probe configured.</p>}
              {probeConfigs.map((p) => {
                const state = p.current_state === 'major_outage' ? 'bg-red-500' : (p.current_state === 'operational' ? 'bg-green-500' : 'bg-gray-400')
                const probeResults = probes.filter(res => res.probe_id === p.id).slice(0, 3)
                return (
                  <div key={p.id} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span className={`w-2.5 h-2.5 rounded-full ${state}`} />
                          <ProbeFavicon probeType={p.probe_type} probeUrl={p.probe_target} />
                          <span className="truncate">{p.name || 'Probe'}</span>
                          {!p.probe_enabled && <span className="badge bg-gray-100 text-gray-600">Disabled</span>}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">{String(p.probe_type || '').toUpperCase()} · {p.probe_target}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        {probeConfigs.length > 1 && p.probe_enabled && (
                          <button className="btn-secondary text-xs flex items-center gap-1" disabled={probingProbeId === p.id} onClick={() => handleProbeNowById(p.id)}>
                            <Play size={11} />{probingProbeId === p.id ? 'Running...' : 'Run'}
                          </button>
                        )}
                        {canEdit && editMode && (
                          <>
                            <button className="btn-secondary text-xs" onClick={() => openAdditionalProbeConfig(p)}>Edit</button>
                            <button className="btn-danger text-xs" onClick={() => setProbeDeleteTarget({ id: p.id, name: p.name })}>Delete</button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
                      <span>Interval: {p.probe_interval_seconds}s</span>
                      <span>Timeout: {p.probe_timeout_seconds}s</span>
                      <span>Fail/Rec: {p.failure_threshold}/{p.recovery_threshold}</span>
                      {p.probe_type === 'dns' && <span>DNS: {p.dns_record_type}{p.dns_expected_value ? ` · ${p.dns_expected_value}` : ''}</span>}
                      {p.probe_type === 'tls' && <span>TLS warn: {p.ssl_expiry_warning_days}d</span>}
                    </div>
                    {/* Probe results for this specific probe */}
                    {probeResults.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                        <div className="text-xs font-semibold text-gray-600 mb-2">Recent results</div>
                        <div className="space-y-1">
                          {probeResults.map(pr => (
                            <div key={pr.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-gray-50 dark:bg-gray-700/30">
                              <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${pr.success ? 'bg-green-500' : 'bg-red-500'}`} />
                                <span className={`font-semibold ${pr.success ? 'text-green-700' : 'text-red-700'}`}>{pr.success ? 'OK' : 'Fail'}</span>
                                <span className="text-gray-500">{pr.response_time_ms ?? '—'}ms</span>
                              </div>
                              <span className="text-gray-400">{format(new Date(pr.probed_at), 'MM/dd HH:mm')}</span>
                            </div>
                          ))}
                        </div>
                        {probes.filter(res => res.probe_id === p.id).length > 3 && (
                          <div className="mt-2 flex justify-end">
                            <button type="button" className="btn-secondary text-xs" onClick={() => { setProbeHistoryForProbeId(p.id); setProbeHistoryOpen(true) }}>
                              Show all ({probes.filter(res => res.probe_id === p.id).length})
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
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
                        {l.expiry_date && <span className="text-gray-500">Expiry: {formatDateOnlyLabel(l.expiry_date)}</span>}
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
                          {l.expiry_date && <span className="text-gray-500">Expiry: {formatDateOnlyLabel(l.expiry_date)}</span>}
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

        {/* Maintenance tab */}
        {tab === 'maintenance' && (
          <div className="space-y-3">
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>{['Title','Status','Impact','Start','End','Ticket','Reopened by'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {maintenance.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No maintenance records</td></tr>}
                  {maintenance.map((m) => (
                        <tr
                          key={m.id}
                          className="hover:bg-gray-50 dark:hover:bg-gray-700/40 cursor-pointer"
                          onClick={() => openMaintenanceDetail(m.id)}
                          onDoubleClick={() => navigate(`/maintenance/${m.id}`)}
                          title="Click: details modal · Double click: open maintenance page"
                        >
                          <td className="px-4 py-3 font-medium">{m.title}</td>
                          <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                          <td className="px-4 py-3"><CriticalityBadge criticality={m.impact_level || 'medium'} /></td>
                          <td className="px-4 py-3 text-gray-500">{m.scheduled_start ? format(new Date(m.scheduled_start), 'MM/dd/yyyy HH:mm') : '—'}</td>
                          <td className="px-4 py-3 text-gray-500">{m.scheduled_end ? format(new Date(m.scheduled_end), 'MM/dd/yyyy HH:mm') : '—'}</td>
                          <td className="px-4 py-3 text-xs text-brand-600 font-medium">{m.ticket_ref || '—'}</td>
                          <td className="px-4 py-3 text-xs">{m.reopened_at ? (m.reopened_by_user?.display_name || 'Unknown') : '—'}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            {maintenanceTotal > 25 && (
              <div className="flex items-center justify-end gap-2 text-sm">
                <button className="btn-secondary" disabled={maintenancePage <= 1} onClick={() => loadMaintenance(maintenancePage - 1)}>Prev</button>
                <span className="text-gray-500">Page {maintenancePage} / {Math.max(1, Math.ceil(maintenanceTotal / 25))}</span>
                <button className="btn-secondary" disabled={maintenancePage >= Math.ceil(maintenanceTotal / 25)} onClick={() => loadMaintenance(maintenancePage + 1)}>Next</button>
              </div>
            )}
          </div>
        )}

        {/* Correlations tab */}
        {tab === 'correlations' && (
          <div className="card p-6">
            <CorrelationGraphLoader entityId={id} entityType="service" />
          </div>
        )}

        {/* Users tab */}
        {tab === 'users' && (
          <div className="card overflow-hidden">
            <div className="p-3 border-b border-gray-100 dark:border-gray-700">
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Users involved ({filteredUsers.length})</p>
                {filteredUsers.length === 0 ? (
                  <p className="text-xs text-gray-400">No users data available</p>
                ) : (
                  <p className="text-xs text-gray-400">Click "Show users" to view the full user list.</p>
                )}
              </div>
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Offices involved ({impactedOffices.length})</p>
                {impactedOffices.length === 0 ? (
                  <p className="text-xs text-gray-400">No office data available</p>
                ) : (
                  <p className="text-xs text-gray-400">Click "Show offices" to view the full office list.</p>
                )}
              </div>
              <div className="flex justify-start gap-2">
                <button type="button" className="btn-secondary" onClick={() => setUsersModalOpen(true)}>
                  Show users ({filteredUsers.length})
                </button>
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1"
                  onClick={() => { setOfficeSearch(''); setOfficesModalOpen(true) }}
                >
                  <Building2 size={13} />
                  Show offices ({impactedOffices.length})
                </button>
              </div>
            </div>

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
                  </div>
                  <div className="flex justify-end">
                    <button type="button" className="btn-secondary" onClick={() => setUsersModalOpen(false)}>Close</button>
                  </div>
                </div>
              </Modal>
            )}

            {officesModalOpen && (
              <Modal title={`Offices involved (${impactedOffices.length})`} onClose={() => setOfficesModalOpen(false)} size="md">
                <div className="space-y-3">
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      className="input pl-8"
                      placeholder="Search office..."
                      value={officeSearch}
                      onChange={(e) => setOfficeSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-[50vh] overflow-auto space-y-2">
                    {impactedOffices
                      .filter((office) => String(office || '').toLowerCase().includes(officeSearch.toLowerCase()))
                      .map((office) => (
                        <div key={office} className="px-3 py-2 rounded-lg border border-indigo-100 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 text-sm text-indigo-800 dark:text-indigo-200">
                          {office}
                        </div>
                      ))}
                    {impactedOffices.filter((office) => String(office || '').toLowerCase().includes(officeSearch.toLowerCase())).length === 0 && (
                      <p className="text-sm text-gray-500">No offices found.</p>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <button type="button" className="btn-secondary" onClick={() => setOfficesModalOpen(false)}>Close</button>
                  </div>
                </div>
              </Modal>
            )}

          </div>
        )}
      </div>

      {/* Probe Configuration Modal - outside tab blocks so it always renders */}
      {probeConfigOpen && probeForm && (
        <Modal title={editingProbeId ? 'Edit probe' : 'Add probe'} onClose={() => { setProbeConfigOpen(false); setProbeForm(null); setEditingProbeId(null) }} size="md">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input type="text" className="w-full input" placeholder="e.g., Health check" value={probeForm?.name || ''} onChange={(e) => setProbeForm({ ...probeForm, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
                <select className="w-full input text-sm" value={probeForm?.probe_type || 'https'} onChange={(e) => setProbeForm({ ...probeForm, probe_type: e.target.value })}>
                  <option value="https">HTTPS</option>
                  <option value="http">HTTP</option>
                  <option value="tcp">TCP</option>
                  <option value="icmp">ICMP (ping)</option>
                  <option value="dns">DNS</option>
                  <option value="tls">TLS</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {{'tcp':'Host:Port','icmp':'Host or IP','dns':'Hostname','tls':'Host:Port'}[probeForm?.probe_type] || 'URL'}
                </label>
                <div className="flex items-center gap-1.5">
                  <ProbeFavicon probeType={probeForm?.probe_type} probeUrl={probeForm?.probe_url} />
                  <input type="text" className="input text-sm flex-1" placeholder={{'tcp':'hostname:443','icmp':'192.168.1.1','dns':'example.com','tls':'hostname:443','https':'https://example.com/health','http':'http://example.com/health'}[probeForm?.probe_type] || ''} value={probeForm?.probe_url || ''} onChange={(e) => setProbeForm({ ...probeForm, probe_url: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Interval (s)</label>
                <input type="number" className="w-full input text-sm" min="30" value={probeForm?.probe_interval_seconds || 300} onChange={(e) => setProbeForm({ ...probeForm, probe_interval_seconds: parseInt(e.target.value) || 300 })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Timeout (s)</label>
                <input type="number" className="w-full input text-sm" min="1" value={probeForm?.probe_timeout_seconds || 10} onChange={(e) => setProbeForm({ ...probeForm, probe_timeout_seconds: parseInt(e.target.value) || 10 })} />
              </div>
              {['http','https'].includes(probeForm?.probe_type) && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Expected HTTP</label>
                  <input type="number" className="w-full input text-sm" min="100" max="599" value={probeForm?.expected_status_code || 200} onChange={(e) => setProbeForm({ ...probeForm, expected_status_code: parseInt(e.target.value) || 200 })} />
                </div>
              )}
            </div>
            {probeForm?.probe_type === 'dns' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Record type</label>
                  <select className="w-full input text-sm" value={probeForm?.dns_record_type || 'A'} onChange={(e) => setProbeForm({ ...probeForm, dns_record_type: e.target.value })}>
                    {['A','AAAA','CNAME','MX','TXT','NS','PTR','SRV'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Expected value <span className="font-normal text-gray-400">(optional)</span></label>
                  <input className="w-full input text-sm" placeholder="e.g. 93.184.216.34" value={probeForm?.dns_expected_value || ''} onChange={(e) => setProbeForm({ ...probeForm, dns_expected_value: e.target.value })} />
                </div>
              </div>
            )}
            {probeForm?.probe_type === 'tls' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Warn if cert expires within (days)</label>
                <input type="number" className="input text-sm w-32" min="1" max="365" value={probeForm?.ssl_expiry_warning_days || 30} onChange={(e) => setProbeForm({ ...probeForm, ssl_expiry_warning_days: parseInt(e.target.value) || 30 })} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Failure threshold</label>
                <input type="number" className="w-full input text-sm" min="1" value={probeForm?.failure_threshold || 2} onChange={(e) => setProbeForm({ ...probeForm, failure_threshold: parseInt(e.target.value) || 2 })} />
                <p className="text-xs text-gray-400 mt-0.5">Consecutive failures → major outage</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Recovery threshold</label>
                <input type="number" className="w-full input text-sm" min="1" value={probeForm?.recovery_threshold || 2} onChange={(e) => setProbeForm({ ...probeForm, recovery_threshold: parseInt(e.target.value) || 2 })} />
                <p className="text-xs text-gray-400 mt-0.5">Consecutive successes → operational</p>
              </div>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" className="rounded border-gray-300 text-brand-600" checked={probeForm?.pause_during_maintenance || false} onChange={(e) => setProbeForm({ ...probeForm, pause_during_maintenance: e.target.checked })} />
              <span className="text-xs text-gray-600 dark:text-gray-300">Pause probing during maintenance windows</span>
            </label>
            <div className="flex gap-2 justify-end pt-2 border-t border-gray-100 dark:border-gray-700">
              <button type="button" className="btn-secondary" onClick={() => { setProbeConfigOpen(false); setProbeForm(null); setEditingProbeId(null) }}>Cancel</button>
              <button type="button" className="btn-primary" disabled={savingProbe} onClick={saveProbeConfig}>{savingProbe ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Probe History Modal - outside tab blocks so it always renders */}
      {probeHistoryOpen && probeHistoryForProbeId && (
        <Modal title={`Probe history - ${probeConfigs.find(p => p.id === probeHistoryForProbeId)?.name || 'Probe'}`} onClose={() => { setProbeHistoryOpen(false); setProbeHistoryForProbeId(null) }} size="xl">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
                <tr>{['Result','Resp. ms','Info','Date'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {probes.filter(p => p.probe_id === probeHistoryForProbeId).length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">No results yet.</td></tr>
                )}
                {probes.filter(p => p.probe_id === probeHistoryForProbeId).map(p => (
                  <tr key={p.id}>
                    <td className="px-4 py-2">{p.success ? '✅' : '❌'}</td>
                    <td className="px-4 py-2">{p.response_time_ms ?? '—'}</td>
                    <td className="px-4 py-2">
                      <button type="button" className="inline-flex items-center gap-1 text-brand-600 hover:underline text-xs" onClick={() => openProbeDetails(p)}>
                        <Info size={13} />Info
                      </button>
                    </td>
                    <td className="px-4 py-2 text-gray-500">{format(new Date(p.probed_at), 'MM/dd HH:mm:ss')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {probeDetails && (
        <Modal title="Probe details" onClose={() => setProbeDetails(null)} size="md">
          <div className="space-y-2 text-sm">
            <div><span className="text-gray-500">Type:</span> <strong>{probeConfigs.find(p => p.id === probeDetails.probe_id)?.probe_type?.toUpperCase() ?? '—'}</strong></div>
            <div><span className="text-gray-500">Success:</span> <strong>{probeDetails.success ? 'Yes' : 'No'}</strong></div>
            <div><span className="text-gray-500">Response time:</span> <strong>{probeDetails.response_time_ms ?? '—'} ms</strong></div>
            <div><span className="text-gray-500">Status code:</span> <strong>{probeDetails.status_code ?? '—'}</strong></div>
            <div><span className="text-gray-500">Error:</span> <strong>{probeDetails.error_message || '—'}</strong></div>
            <div><span className="text-gray-500">TLS expiry:</span> <strong>{probeDetails.ssl_cert_expiry ? format(new Date(probeDetails.ssl_cert_expiry), 'MM/dd/yyyy') : '—'}</strong></div>
            <div><span className="text-gray-500">DNS response:</span> <strong className="break-all">{probeDetails.dns_response || '—'}</strong></div>
          </div>
        </Modal>
      )}

      {maintenanceDetailOpen && maintenanceDetail && (
        <Modal title={`Maintenance: ${maintenanceDetail.title || 'Detail'}`} onClose={() => { setMaintenanceDetailOpen(false); setMaintenanceDetail(null) }} size="lg">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={maintenanceDetail.status} />
              <CriticalityBadge criticality={maintenanceDetail.impact_level || 'medium'} />
              {maintenanceDetail.ticket_ref && <span className="badge bg-indigo-100 text-indigo-700">Ticket: {maintenanceDetail.ticket_ref}</span>}
              {maintenanceDetail.owner_approval_required && <span className={`badge ${maintenanceDetail.owner_approval_status === 'approved' ? 'bg-green-100 text-green-700' : maintenanceDetail.owner_approval_status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>Owner approval: {maintenanceDetail.owner_approval_status || 'pending'}</span>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm text-gray-600 dark:text-gray-300">
              <div><span className="font-medium">Start:</span> {maintenanceDetail.scheduled_start ? format(new Date(maintenanceDetail.scheduled_start), 'MM/dd/yyyy HH:mm') : '—'}</div>
              <div><span className="font-medium">End:</span> {maintenanceDetail.scheduled_end ? format(new Date(maintenanceDetail.scheduled_end), 'MM/dd/yyyy HH:mm') : '—'}</div>
              <div><span className="font-medium">Actual start:</span> {maintenanceDetail.actual_start ? format(new Date(maintenanceDetail.actual_start), 'MM/dd/yyyy HH:mm') : '—'}</div>
              <div><span className="font-medium">Actual end:</span> {maintenanceDetail.actual_end ? format(new Date(maintenanceDetail.actual_end), 'MM/dd/yyyy HH:mm') : '—'}</div>
              {maintenanceDetail.reopened_at && <div><span className="font-medium">Reopened:</span> {format(new Date(maintenanceDetail.reopened_at), 'MM/dd/yyyy HH:mm')}</div>}
              {maintenanceDetail.reopened_by_user && <div><span className="font-medium">Reopened by:</span> {maintenanceDetail.reopened_by_user.display_name || 'Unknown'}</div>}
            </div>
            {(maintenanceDetail.description || maintenanceDetail.notes || maintenanceDetail.reopen_reason) && (
              <div className="space-y-1 text-sm">
                {maintenanceDetail.description && <p className="text-gray-700 dark:text-gray-200">{maintenanceDetail.description}</p>}
                {maintenanceDetail.notes && <p className="text-gray-600 dark:text-gray-300"><span className="font-medium">Notes:</span> {maintenanceDetail.notes}</p>}
                {maintenanceDetail.reopen_reason && <p className="text-amber-700"><span className="font-medium">Reopen reason:</span> {maintenanceDetail.reopen_reason}</p>}
              </div>
            )}
            <div>
              <p className="text-sm font-semibold mb-2">Timeline</p>
              <div className="space-y-2 max-h-56 overflow-auto">
                {(maintenanceDetail.statusHistory || []).length === 0 && <p className="text-xs text-gray-500">No timeline entries.</p>}
                {(maintenanceDetail.statusHistory || []).map((h) => (
                  <div key={h.id} className="text-xs rounded border border-gray-200 dark:border-gray-700 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-700 dark:text-gray-200">{h.status}</span>
                      <span className="text-gray-500">{h.created_at ? format(new Date(h.created_at), 'MM/dd HH:mm') : '—'}</span>
                    </div>
                    {h.reason && <div className="text-gray-600 dark:text-gray-300 mt-0.5">{h.reason}</div>}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <button type="button" className="btn-secondary" onClick={() => navigate(`/maintenance/${maintenanceDetail.id}`)}>Open maintenance page</button>
            </div>
          </div>
        </Modal>
      )}

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

      {probeDeleteTarget && (
        <ConfirmDialog
          title="Delete Probe"
          message={`Delete probe "${probeDeleteTarget.name}"?`}
          danger
          confirmLabel="Delete"
          onConfirm={() => deleteProbeConfig(probeDeleteTarget.id)}
          onCancel={() => setProbeDeleteTarget(null)}
        />
      )}

      {licenseRemoveTarget && (
        <ConfirmDialog
          title="Remove License"
          message={`Remove license "${licenseRemoveTarget.name}" from this service?`}
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