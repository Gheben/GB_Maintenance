import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Modal } from '../components/Modal'
import { ItemPicker } from '../components/ItemPicker'
import { toast } from '../components/Toast'
import { maintenanceApi, assetsApi, servicesApi } from '../api'
import { format } from 'date-fns'
import { ArrowLeft, CheckCircle, XCircle, Play, Square, Ban, Pencil, Save, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const TYPES = ['planned','emergency','upgrade','security_patch','infrastructure','other']
const IMPACTS = ['critical','high','medium','low']

function toDatetimeLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return format(d, "yyyy-MM-dd'T'HH:mm")
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
  const [saving, setSaving] = useState(false)

  const load = () => maintenanceApi.get(id).then(r => setMw(r.data)).catch(() => navigate('/maintenance'))
  useEffect(() => { load() }, [id])

  const action = async (fn, successMsg) => {
    try { await fn(); toast.success(successMsg); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
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

  const canEdit = hasRole('superadmin','admin','change_manager') && ['draft','scheduled','pending_approval'].includes(mw.status)

  return (
    <Layout title={editMode ? 'Edit Maintenance' : mw.title}>
      <div className="max-w-3xl space-y-6">
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
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
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
              />
              <ItemPicker
                label={`Services (${editForm.service_ids.length} selected)`}
                allItems={allServices}
                selectedIds={editForm.service_ids}
                onToggle={toggleService}
                badgeKey="criticality"
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
                  <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Selected</p>
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
      </div>

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
