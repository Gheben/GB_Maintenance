import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Modal } from '../components/Modal'
import { ItemPicker } from '../components/ItemPicker'
import { toast } from '../components/Toast'
import { maintenanceApi, assetsApi, servicesApi } from '../api'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
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
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
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
    if (!editForm.title.trim()) { toast.error('Il titolo è obbligatorio'); return }
    if (!editForm.scheduled_start || !editForm.scheduled_end) { toast.error('Date obbligatorie'); return }
    setSaving(true)
    try {
      await maintenanceApi.update(id, editForm)
      toast.success('Manutenzione aggiornata')
      setEditMode(false)
      setEditForm(null)
      load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Errore salvataggio')
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

  if (!mw) return <Layout title="Manutenzione"><div className="text-center py-16 text-gray-500">Caricamento...</div></Layout>

  const canEdit = hasRole('superadmin','admin','change_manager') && ['draft','scheduled','pending_approval'].includes(mw.status)

  return (
    <Layout title={editMode ? 'Modifica Manutenzione' : mw.title}>
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/maintenance" className="flex items-center gap-1 text-gray-500 hover:text-gray-700 text-sm"><ArrowLeft size={16} />Manutenzioni</Link>
          <div className="flex gap-2 flex-wrap">
            {!editMode && canEdit && (
              <button className="btn-secondary flex items-center gap-1" onClick={enterEdit}>
                <Pencil size={14} />Modifica
              </button>
            )}
            {editMode && (
              <>
                <button className="btn-secondary flex items-center gap-1" onClick={cancelEdit} disabled={saving}>
                  <X size={14} />Annulla
                </button>
                <button className="btn-primary flex items-center gap-1" onClick={saveEdit} disabled={saving}>
                  <Save size={14} />{saving ? 'Salvataggio...' : 'Salva'}
                </button>
              </>
            )}
            {!editMode && <>
              {mw.status === 'pending_approval' && hasRole('superadmin','admin','change_manager') && <>
                <button className="btn-primary flex items-center gap-1" onClick={() => action(() => maintenanceApi.approve(id), 'Approvata')}><CheckCircle size={14} />Approva</button>
                <button className="btn-danger flex items-center gap-1" onClick={() => setRejectModal(true)}><XCircle size={14} />Rifiuta</button>
              </>}
              {mw.status === 'scheduled' && <button className="btn-primary flex items-center gap-1" onClick={() => action(() => maintenanceApi.start(id), 'Avviata')}><Play size={14} />Avvia</button>}
              {mw.status === 'in_progress' && <button className="btn-primary flex items-center gap-1" onClick={() => action(() => maintenanceApi.complete(id), 'Completata')}><Square size={14} />Completa</button>}
              {['scheduled','in_progress','pending_approval'].includes(mw.status) && (
                <button className="btn-secondary flex items-center gap-1" onClick={() => action(() => maintenanceApi.cancel(id, 'Annullata manualmente'), 'Annullata')}><Ban size={14} />Annulla</button>
              )}
            </>}
          </div>
        </div>

        {/* ── EDIT MODE ──────────────────────────────────────────── */}
        {editMode && editForm ? (
          <div className="card p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium mb-1">Titolo *</label>
              <input className="input" value={editForm.title} onChange={e => setEditForm(f => ({...f, title: e.target.value}))} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Tipo</label>
                <select className="input" value={editForm.type} onChange={e => setEditForm(f => ({...f, type: e.target.value}))}>
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Impatto</label>
                <select className="input" value={editForm.impact_level} onChange={e => setEditForm(f => ({...f, impact_level: e.target.value}))}>
                  {IMPACTS.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Inizio *</label>
                <input type="datetime-local" className="input" value={editForm.scheduled_start} onChange={e => setEditForm(f => ({...f, scheduled_start: e.target.value}))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Fine *</label>
                <input type="datetime-local" className="input" value={editForm.scheduled_end} onChange={e => setEditForm(f => ({...f, scheduled_end: e.target.value}))} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Descrizione</label>
              <textarea className="input" rows={3} value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))} />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Note</label>
              <textarea className="input" rows={2} value={editForm.notes} onChange={e => setEditForm(f => ({...f, notes: e.target.value}))} />
            </div>

            <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 space-y-4">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Asset e Servizi coinvolti</h4>
              <ItemPicker
                label={`Asset (${editForm.asset_ids.length} selezionati)`}
                allItems={allAssets}
                selectedIds={editForm.asset_ids}
                onToggle={toggleAsset}
                badgeKey="criticality"
              />
              <ItemPicker
                label={`Servizi (${editForm.service_ids.length} selezionati)`}
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
              <div><span className="text-gray-500">Inizio:</span> <strong>{format(new Date(mw.scheduled_start), 'dd MMM yyyy HH:mm', { locale: it })}</strong></div>
              <div><span className="text-gray-500">Fine:</span> <strong>{format(new Date(mw.scheduled_end), 'dd MMM yyyy HH:mm', { locale: it })}</strong></div>
              {mw.actual_start && <div><span className="text-gray-500">Avvio effettivo:</span> <strong>{format(new Date(mw.actual_start), 'dd/MM HH:mm', { locale: it })}</strong></div>}
              {mw.actual_end && <div><span className="text-gray-500">Fine effettiva:</span> <strong>{format(new Date(mw.actual_end), 'dd/MM HH:mm', { locale: it })}</strong></div>}
            </div>

            {mw.description && <p className="text-gray-600 dark:text-gray-300 text-sm">{mw.description}</p>}
            {mw.notes && <p className="text-gray-600 dark:text-gray-300 text-sm"><strong>Note:</strong> {mw.notes}</p>}
            {mw.rejection_reason && <p className="text-red-600 text-sm"><strong>Motivo rifiuto:</strong> {mw.rejection_reason}</p>}
          </div>

          {/* Assets */}
          <div className="card p-5">
            <h3 className="font-medium mb-3">Asset coinvolti ({mw.assets?.length || 0})</h3>
            <div className="space-y-2">
              {mw.assets?.length === 0 && <p className="text-gray-500 text-sm">Nessun asset</p>}
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
              <h3 className="font-medium mb-3">Servizi coinvolti</h3>
              {mw.services?.length > 0 && (
                <>
                  <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Selezionati</p>
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
                  <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Derivati dagli asset</p>
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
        <Modal title="Rifiuta Manutenzione" onClose={() => setRejectModal(false)} size="sm">
          <div className="space-y-4">
            <textarea className="input" rows={3} placeholder="Motivo del rifiuto..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
            <div className="flex justify-end gap-3">
              <button className="btn-secondary" onClick={() => setRejectModal(false)}>Annulla</button>
              <button className="btn-danger" onClick={async () => {
                await action(() => maintenanceApi.reject(id, rejectReason), 'Rifiutata')
                setRejectModal(false)
              }}>Rifiuta</button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  )
}
