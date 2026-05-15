import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Modal } from '../components/Modal'
import { ItemPicker } from '../components/ItemPicker'
import { toast } from '../components/Toast'
import { maintenanceApi, assetsApi, servicesApi, maintenanceTypesApi } from '../api'
import { format } from 'date-fns'
import { ArrowLeft, CheckCircle, XCircle, Play, Square, Ban, Pencil, Save, X, ClipboardCheck } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const IMPACTS = ['critical','high','medium','low']

function toDatetimeLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return format(d, "yyyy-MM-dd'T'HH:mm")
}

function ownerActionLabel(status) {
  if (status === 'approved' || status === 'creator_accepted') return 'Approved'
  if (status === 'rejected' || status === 'creator_rejected') return 'Rejected'
  if (status === 'reschedule_proposed') return 'Requested reschedule'
  if (status === 'counter_proposed') return 'Counter proposal pending'
  return 'Pending'
}

function creatorActionLabel(status) {
  if (status === 'creator_accepted') return 'Accepted owner proposal'
  if (status === 'creator_rejected') return 'Rejected owner proposal'
  if (status === 'counter_proposed') return 'Sent counter proposal'
  return 'No decision yet'
}

export default function MaintenanceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const [mw, setMw] = useState(null)
  const [rejectModal, setRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  // Edit mode
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [allAssets, setAllAssets] = useState([])
  const [allServices, setAllServices] = useState([])
  const [mTypes, setMTypes] = useState([])
  const [saving, setSaving] = useState(false)
  const [mwUsers, setMwUsers] = useState([])
  const [userSearch, setUserSearch] = useState('')
  const [userLimit, setUserLimit] = useState(25)
  const [showApprovalModal, setShowApprovalModal] = useState(false)
  const [approvalData, setApprovalData] = useState(null)
  const [approvalLoading, setApprovalLoading] = useState(false)
  const [ownerForms, setOwnerForms] = useState({})
  const [creatorForms, setCreatorForms] = useState({})

  const load = () => maintenanceApi.get(id).then(r => setMw(r.data)).catch(() => navigate('/maintenance'))
  useEffect(() => { load(); maintenanceTypesApi.list().then(r => setMTypes(r.data)).catch(() => {}) }, [id])
  useEffect(() => {
    if (!editMode) maintenanceApi.users(id).then(r => setMwUsers(r.data)).catch(() => {})
  }, [id, editMode])

  const action = async (fn, successMsg) => {
    try { await fn(); toast.success(successMsg); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const formatDateTimeForInput = (value) => {
    if (!value) return ''
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hh}:${mm}`
  }

  const loadApprovalStatus = async () => {
    setApprovalLoading(true)
    try {
      const r = await maintenanceApi.approvalStatus(id)
      setApprovalData(r.data)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Cannot load approval status')
    } finally {
      setApprovalLoading(false)
    }
  }

  const openApprovalModal = async () => {
    setShowApprovalModal(true)
    await loadApprovalStatus()
  }

  const ownerFormFor = (row) => ownerForms[row.id] || {
    action: 'approve',
    note: '',
    proposed_start: formatDateTimeForInput(row.proposed_start),
    proposed_end: formatDateTimeForInput(row.proposed_end),
  }

  const creatorFormFor = (row) => creatorForms[row.id] || {
    action: 'accept',
    note: '',
    counter_start: formatDateTimeForInput(row.creator_proposed_start),
    counter_end: formatDateTimeForInput(row.creator_proposed_end),
  }

  const updateOwnerForm = (rowId, patch) => {
    setOwnerForms(prev => ({ ...prev, [rowId]: { ...(prev[rowId] || {}), ...patch } }))
  }

  const updateCreatorForm = (rowId, patch) => {
    setCreatorForms(prev => ({ ...prev, [rowId]: { ...(prev[rowId] || {}), ...patch } }))
  }

  const submitOwnerResponse = async (row) => {
    const form = ownerFormFor(row)
    if (form.action === 'reschedule' && (!form.proposed_start || !form.proposed_end)) {
      toast.error('Set proposed start and end date')
      return
    }
    try {
      await maintenanceApi.ownerRespond(id, row.id, {
        action: form.action,
        note: form.note,
        proposed_start: form.action === 'reschedule' ? form.proposed_start : undefined,
        proposed_end: form.action === 'reschedule' ? form.proposed_end : undefined,
      })
      toast.success('Owner response saved')
      await Promise.all([load(), loadApprovalStatus()])
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error saving owner response')
    }
  }

  const submitCreatorDecision = async (row) => {
    const form = creatorFormFor(row)
    if (form.action === 'counter_propose' && (!form.counter_start || !form.counter_end)) {
      toast.error('Set counter proposal start and end date')
      return
    }
    try {
      await maintenanceApi.creatorDecision(id, row.id, {
        action: form.action,
        note: form.note,
        counter_start: form.action === 'counter_propose' ? form.counter_start : undefined,
        counter_end: form.action === 'counter_propose' ? form.counter_end : undefined,
      })
      toast.success('Creator decision saved')
      await Promise.all([load(), loadApprovalStatus()])
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error saving creator decision')
    }
  }

  const enterEdit = () => {
    if (!mw) return
    setEditForm({
      title: mw.title || '',
      type: mw.type || 'planned',
      impact_level: mw.impact_level || 'medium',
      description: mw.description || '',
      notes: mw.notes || '',
      scheduled_start: toDatetimeLocal(mw.scheduled_start),
      scheduled_end: toDatetimeLocal(mw.scheduled_end),
      asset_ids: (mw.assets || []).map(a => a.id),
      service_ids: (mw.services || []).map(s => s.id),
    })
    assetsApi.list({ limit: 500 }).then(r => setAllAssets(Array.isArray(r.data) ? r.data : (r.data.data || [])))
    servicesApi.list({ limit: 500 }).then(r => setAllServices(Array.isArray(r.data) ? r.data : (r.data.data || [])))
    setEditMode(true)
  }

  const cancelEdit = () => { setEditMode(false); setEditForm(null) }

  const saveEdit = async () => {
    if (!editForm.title.trim()) { toast.error('Title is required'); return }
    if (!editForm.scheduled_start || !editForm.scheduled_end) { toast.error('Dates are required'); return }
    setSaving(true)
    try {
      await maintenanceApi.update(id, editForm)
      toast.success('Maintenance updated')
      setEditMode(false)
      setEditForm(null)
      load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save error')
    } finally {
      setSaving(false)
    }
  }

  const toggleAsset = (aid) => setEditForm(f => ({
    ...f, asset_ids: f.asset_ids.includes(aid) ? f.asset_ids.filter(x => x !== aid) : [...f.asset_ids, aid]
  }))
  const toggleService = (sid) => setEditForm(f => ({
    ...f, service_ids: f.service_ids.includes(sid) ? f.service_ids.filter(x => x !== sid) : [...f.service_ids, sid]
  }))

  if (!mw) return <Layout title="Maintenance"><div className="text-center py-16 text-gray-500">Loading...</div></Layout>

  const canEdit = hasRole('superadmin','admin','change_manager') && !['completed','cancelled'].includes(mw.status)

  return (
    <Layout title={editMode ? 'Edit Maintenance' : mw.title}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/maintenance" className="flex items-center gap-1 text-gray-500 hover:text-gray-700 text-sm"><ArrowLeft size={16} />Maintenance</Link>
          <div className="flex gap-2 flex-wrap">
            {!editMode && canEdit && (
              <button className="btn-secondary flex items-center gap-1" onClick={enterEdit}>
                <Pencil size={14} />Edit
              </button>
            )}
            {editMode && (
              <>
                <button className="btn-secondary flex items-center gap-1" onClick={cancelEdit} disabled={saving}>
                  <X size={14} />Cancel
                </button>
                <button className="btn-primary flex items-center gap-1" onClick={saveEdit} disabled={saving}>
                  <Save size={14} />{saving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
            {!editMode && mw.owner_approval_required && (
              <button className="btn-secondary flex items-center gap-1" onClick={openApprovalModal}>
                <ClipboardCheck size={14} />Check approval status
              </button>
            )}
            {!editMode && <>
              {mw.status === 'pending_approval' && hasRole('superadmin','admin','change_manager') && <>
                <button className="btn-primary flex items-center gap-1" onClick={() => action(() => maintenanceApi.approve(id), 'Approved')}><CheckCircle size={14} />Approve</button>
                <button className="btn-danger flex items-center gap-1" onClick={() => setRejectModal(true)}><XCircle size={14} />Reject</button>
              </>}
              {mw.status === 'scheduled' && <button className="btn-primary flex items-center gap-1" onClick={() => action(() => maintenanceApi.start(id), 'Started')}><Play size={14} />Start</button>}
              {mw.status === 'in_progress' && <button className="btn-primary flex items-center gap-1" onClick={() => action(() => maintenanceApi.complete(id), 'Completed')}><Square size={14} />Complete</button>}
              {['scheduled','in_progress','pending_approval'].includes(mw.status) && (
                <button className="btn-secondary flex items-center gap-1" onClick={() => action(() => maintenanceApi.cancel(id, 'Manually cancelled'), 'Cancelled')}><Ban size={14} />Cancel</button>
              )}
            </>}
          </div>
        </div>

        {/* ── EDIT MODE ──────────────────────────────────────────── */}
        {editMode && editForm ? (
          <div className="card p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium mb-1">Title *</label>
              <input className="input" value={editForm.title} onChange={e => setEditForm(f => ({...f, title: e.target.value}))} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select className="input" value={editForm.type} onChange={e => setEditForm(f => ({...f, type: e.target.value}))}>
                  {mTypes.map(t => <option key={t.slug} value={t.slug}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Impact</label>
                <select className="input" value={editForm.impact_level} onChange={e => setEditForm(f => ({...f, impact_level: e.target.value}))}>
                  {IMPACTS.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Start *</label>
                <input type="datetime-local" className="input" value={editForm.scheduled_start} onChange={e => setEditForm(f => ({...f, scheduled_start: e.target.value}))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">End *</label>
                <input type="datetime-local" className="input" value={editForm.scheduled_end} onChange={e => setEditForm(f => ({...f, scheduled_end: e.target.value}))} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input" rows={3} value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))} />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea className="input" rows={2} value={editForm.notes} onChange={e => setEditForm(f => ({...f, notes: e.target.value}))} />
            </div>

            <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 space-y-4">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Assets and Services</h4>
              <ItemPicker
                label={`Assets (${editForm.asset_ids.length} selected)`}
                allItems={allAssets}
                selectedIds={editForm.asset_ids}
                onToggle={toggleAsset}
                badgeKey="criticality"
                useModal
                filterKey="criticality"
              />
              <ItemPicker
                label={`Services (${editForm.service_ids.length} selected)`}
                allItems={allServices}
                selectedIds={editForm.service_ids}
                onToggle={toggleService}
                badgeKey="criticality"
                useModal
                filterKey="criticality"
              />
            </div>
          </div>

        ) : (

        /* ── READ MODE ─────────────────────────────────────────── */
        <>
          <div className="card p-6 space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={mw.status} />
              <CriticalityBadge criticality={mw.impact_level} />
              <span className="badge bg-gray-100 text-gray-700">{mw.type}</span>
              {mw.owner_approval_required && (
                <span className={`badge ${mw.owner_approval_status === 'approved' ? 'bg-green-100 text-green-700' : mw.owner_approval_status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                  Owner approval: {mw.owner_approval_status || 'pending'}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Start:</span> <strong>{format(new Date(mw.scheduled_start), 'MM/dd/yyyy HH:mm')}</strong></div>
              <div><span className="text-gray-500">End:</span> <strong>{format(new Date(mw.scheduled_end), 'MM/dd/yyyy HH:mm')}</strong></div>
              {mw.actual_start && <div><span className="text-gray-500">Actual start:</span> <strong>{format(new Date(mw.actual_start), 'MM/dd HH:mm')}</strong></div>}
              {mw.actual_end && <div><span className="text-gray-500">Actual end:</span> <strong>{format(new Date(mw.actual_end), 'MM/dd HH:mm')}</strong></div>}
            </div>

            {mw.description && <p className="text-gray-600 dark:text-gray-300 text-sm">{mw.description}</p>}
            {mw.notes && <p className="text-gray-600 dark:text-gray-300 text-sm"><strong>Notes:</strong> {mw.notes}</p>}
            {mw.rejection_reason && <p className="text-red-600 text-sm"><strong>Rejection reason:</strong> {mw.rejection_reason}</p>}
          </div>

          {/* Assets */}
          <div className="card p-5">
            <h3 className="font-medium mb-3">Involved Assets ({mw.assets?.length || 0})</h3>
            <div className="space-y-2">
              {mw.assets?.length === 0 && <p className="text-gray-500 text-sm">No assets</p>}
              {mw.assets?.map(a => (
                <Link key={a.id} to={`/assets/${a.id}`} className="flex items-center justify-between p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <span className="text-sm">{a.name}</span>
                  <div className="flex gap-2">
                    <CriticalityBadge criticality={a.criticality} />
                    <StatusBadge status={a.status} />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Services */}
          {(mw.services?.length > 0 || mw.affectedServices?.length > 0) && (
            <div className="card p-5">
              <h3 className="font-medium mb-3">Involved Services</h3>
              {mw.services?.length > 0 && (
                <>
                  <div className="space-y-2 mb-4">
                    {mw.services.map(s => (
                      <Link key={s.id} to={`/services/${s.id}`} className="flex items-center justify-between p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <span className="text-sm">{s.name}</span>
                        <div className="flex gap-2">
                          <CriticalityBadge criticality={s.criticality} />
                          <StatusBadge status={s.status} />
                        </div>
                      </Link>
                    ))}
                  </div>
                </>
              )}
              {mw.affectedServices?.length > 0 && (
                <>
                  <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Derived from assets</p>
                  <div className="space-y-2">
                    {mw.affectedServices.map(s => (
                      <Link key={s.id} to={`/services/${s.id}`} className="flex items-center justify-between p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <span className="text-sm">{s.name}</span>
                        <div className="flex gap-2">
                          <CriticalityBadge criticality={s.criticality} />
                          <StatusBadge status={s.status} />
                        </div>
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
        )}

        {/* Users */}
        {!editMode && (() => {
          const q = userSearch.toLowerCase()
          const filtered = mwUsers.filter(u => !q ||
            (u.display_name||'').toLowerCase().includes(q) ||
            (u.username||'').toLowerCase().includes(q) ||
            (u.email||'').toLowerCase().includes(q))
          const visible = filtered.slice(0, userLimit)
          return (
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-gray-100 dark:border-gray-700">
                <h3 className="font-medium text-sm mb-2">Impacted users</h3>
                <input className="input text-sm" placeholder="Search users..."
                  value={userSearch} onChange={e => { setUserSearch(e.target.value); setUserLimit(25) }} />
              </div>
              {filtered.length === 0 ? (
                <p className="text-gray-500 text-sm p-5 text-center">No users impacted by this maintenance.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>{['Display Name','Username','Email','Role','Auth'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {visible.map(u => (
                      <tr key={u.id}>
                        <td className="px-4 py-2 font-medium">{u.display_name || u.username}</td>
                        <td className="px-4 py-2 text-gray-500">{u.username}</td>
                        <td className="px-4 py-2 text-gray-500">{u.email || '—'}</td>
                        <td className="px-4 py-2 text-gray-500">{u.role}</td>
                        <td className="px-4 py-2"><span className={`px-1.5 py-0.5 rounded text-xs font-bold ${u.auth_type === 'ldap' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{u.auth_type || 'local'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {filtered.length > userLimit && (
                <div className="p-3 text-center border-t border-gray-100">
                  <button className="text-sm text-brand-600 hover:underline" onClick={() => setUserLimit(l => l + 25)}>
                    Show {filtered.length - userLimit} more
                  </button>
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {showApprovalModal && (
        <Modal title="Owner Approval Workflow" onClose={() => setShowApprovalModal(false)} size="xl">
          <div className="space-y-4">
            {approvalLoading && <p className="text-sm text-gray-500">Loading approval status...</p>}

            {!approvalLoading && approvalData && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg border border-gray-200 px-3 py-2">
                    <p className="text-xs text-gray-500">Overall</p>
                    <p className="font-semibold text-sm">{approvalData.maintenance?.owner_approval_status || 'not_required'}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 px-3 py-2">
                    <p className="text-xs text-gray-500">Pending</p>
                    <p className="font-semibold text-sm text-amber-700">{approvalData.summary?.pending || 0}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 px-3 py-2">
                    <p className="text-xs text-gray-500">Approved</p>
                    <p className="font-semibold text-sm text-green-700">{approvalData.summary?.approved || 0}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 px-3 py-2">
                    <p className="text-xs text-gray-500">Rejected</p>
                    <p className="font-semibold text-sm text-red-700">{approvalData.summary?.rejected || 0}</p>
                  </div>
                </div>

                <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                  {(approvalData.requests || []).length === 0 && (
                    <p className="text-sm text-gray-500">No owner approval requests found for this maintenance.</p>
                  )}

                  {(approvalData.requests || []).map((row) => {
                    const ownerForm = ownerFormFor(row)
                    const creatorForm = creatorFormFor(row)
                    const creatorName = approvalData.maintenance?.created_by_name || 'Maintenance creator'
                    return (
                      <div key={row.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">Request sent to: {row.owner_label}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{row.owner_source_type}: {row.owner_source_name || '-'}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${['approved', 'creator_accepted'].includes(row.status) ? 'bg-green-100 text-green-700' : ['rejected', 'creator_rejected'].includes(row.status) ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            {row.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                          <div className="rounded border border-gray-200 px-2 py-1.5">
                            <p className="text-gray-500">Owner action</p>
                            <p className="font-semibold text-gray-800 dark:text-gray-100">{row.owner_label}: {ownerActionLabel(row.status)}</p>
                          </div>
                          <div className="rounded border border-gray-200 px-2 py-1.5">
                            <p className="text-gray-500">Creator action</p>
                            <p className="font-semibold text-gray-800 dark:text-gray-100">{creatorName}: {creatorActionLabel(row.status)}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-600">
                          <p>Requested: {row.requested_at ? format(new Date(row.requested_at), 'MM/dd/yyyy HH:mm') : '-'}</p>
                          <p>Responded: {row.responded_at ? format(new Date(row.responded_at), 'MM/dd/yyyy HH:mm') : '-'}</p>
                          <p>Proposed: {row.proposed_start ? `${format(new Date(row.proposed_start), 'MM/dd/yyyy HH:mm')} - ${format(new Date(row.proposed_end), 'MM/dd/yyyy HH:mm')}` : '-'}</p>
                          <p>Creator decision: {row.creator_responded_at ? format(new Date(row.creator_responded_at), 'MM/dd/yyyy HH:mm') : '-'}</p>
                          <p>Counter: {row.creator_proposed_start ? `${format(new Date(row.creator_proposed_start), 'MM/dd/yyyy HH:mm')} - ${format(new Date(row.creator_proposed_end), 'MM/dd/yyyy HH:mm')}` : '-'}</p>
                        </div>

                        {row.response_note && <p className="text-xs text-gray-700"><strong>Owner note:</strong> {row.response_note}</p>}
                        {row.creator_response_note && <p className="text-xs text-gray-700"><strong>Creator note:</strong> {row.creator_response_note}</p>}

                        {row.can_owner_respond && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                            <p className="text-xs font-semibold text-amber-800">Your response as owner</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <select
                                className="input"
                                value={ownerForm.action}
                                onChange={e => updateOwnerForm(row.id, { action: e.target.value })}>
                                <option value="approve">Approve</option>
                                <option value="reject">Reject</option>
                                <option value="reschedule">Propose new date</option>
                              </select>
                              <input
                                className="input"
                                placeholder="Optional note"
                                value={ownerForm.note || ''}
                                onChange={e => updateOwnerForm(row.id, { note: e.target.value })}
                              />
                              {ownerForm.action === 'reschedule' && (
                                <>
                                  <input
                                    type="datetime-local"
                                    className="input"
                                    value={ownerForm.proposed_start || ''}
                                    onChange={e => updateOwnerForm(row.id, { proposed_start: e.target.value })}
                                  />
                                  <input
                                    type="datetime-local"
                                    className="input"
                                    value={ownerForm.proposed_end || ''}
                                    onChange={e => updateOwnerForm(row.id, { proposed_end: e.target.value })}
                                  />
                                </>
                              )}
                            </div>
                            <div className="flex justify-end">
                              <button className="btn-primary" type="button" onClick={() => submitOwnerResponse(row)}>Send response</button>
                            </div>
                          </div>
                        )}

                        {row.can_creator_decide && (
                          <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 space-y-2">
                            <p className="text-xs font-semibold text-indigo-800">Creator decision on owner proposal</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <select
                                className="input"
                                value={creatorForm.action}
                                onChange={e => updateCreatorForm(row.id, { action: e.target.value })}>
                                <option value="accept">Accept owner proposal</option>
                                <option value="reject">Reject proposal</option>
                                <option value="counter_propose">Counter propose new date</option>
                              </select>
                              <input
                                className="input"
                                placeholder="Optional note"
                                value={creatorForm.note || ''}
                                onChange={e => updateCreatorForm(row.id, { note: e.target.value })}
                              />
                              {creatorForm.action === 'counter_propose' && (
                                <>
                                  <input
                                    type="datetime-local"
                                    className="input"
                                    value={creatorForm.counter_start || ''}
                                    onChange={e => updateCreatorForm(row.id, { counter_start: e.target.value })}
                                  />
                                  <input
                                    type="datetime-local"
                                    className="input"
                                    value={creatorForm.counter_end || ''}
                                    onChange={e => updateCreatorForm(row.id, { counter_end: e.target.value })}
                                  />
                                </>
                              )}
                            </div>
                            <div className="flex justify-end">
                              <button className="btn-primary" type="button" onClick={() => submitCreatorDecision(row)}>Save decision</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            <div className="flex justify-end">
              <button className="btn-secondary" type="button" onClick={() => setShowApprovalModal(false)}>Close</button>
            </div>
          </div>
        </Modal>
      )}

      {rejectModal && (
        <Modal title="Reject Maintenance" onClose={() => setRejectModal(false)} size="sm">
          <div className="space-y-4">
            <textarea className="input" rows={3} placeholder="Rejection reason..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
            <div className="flex justify-end gap-3">
              <button className="btn-secondary" onClick={() => setRejectModal(false)}>Cancel</button>
              <button className="btn-danger" onClick={async () => {
                await action(() => maintenanceApi.reject(id, rejectReason), 'Rejected')
                setRejectModal(false)
              }}>Reject</button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  )
}
