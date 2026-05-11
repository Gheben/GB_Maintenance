import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { Modal } from '../components/Modal'
import { toast } from '../components/Toast'
import { maintenanceApi } from '../api'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { ArrowLeft, CheckCircle, XCircle, Play, Square, Ban } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function MaintenanceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const [mw, setMw] = useState(null)
  const [rejectModal, setRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const load = () => maintenanceApi.get(id).then(r => setMw(r.data)).catch(() => navigate('/maintenance'))
  useEffect(() => { load() }, [id])

  const action = async (fn, successMsg) => {
    try { await fn(); toast.success(successMsg); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  if (!mw) return <Layout title="Manutenzione"><div className="text-center py-16 text-gray-500">Caricamento...</div></Layout>

  return (
    <Layout title={mw.title}>
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/maintenance" className="flex items-center gap-1 text-gray-500 hover:text-gray-700 text-sm"><ArrowLeft size={16} />Manutenzioni</Link>
          <div className="flex gap-2 flex-wrap">
            {mw.status === 'pending_approval' && hasRole('superadmin','admin','change_manager') && <>
              <button className="btn-primary" onClick={() => action(() => maintenanceApi.approve(id), 'Approvata')}><CheckCircle size={14} />Approva</button>
              <button className="btn-danger" onClick={() => setRejectModal(true)}><XCircle size={14} />Rifiuta</button>
            </>}
            {mw.status === 'scheduled' && <button className="btn-primary" onClick={() => action(() => maintenanceApi.start(id), 'Avviata')}><Play size={14} />Avvia</button>}
            {mw.status === 'in_progress' && <button className="btn-primary" onClick={() => action(() => maintenanceApi.complete(id), 'Completata')}><Square size={14} />Completa</button>}
            {['scheduled','in_progress','pending_approval'].includes(mw.status) && (
              <button className="btn-secondary" onClick={() => action(() => maintenanceApi.cancel(id, 'Annullata manualmente'), 'Annullata')}><Ban size={14} />Annulla</button>
            )}
          </div>
        </div>

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
