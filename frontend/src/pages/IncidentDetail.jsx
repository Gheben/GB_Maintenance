import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { toast } from '../components/Toast'
import { incidentsApi } from '../api'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { ArrowLeft } from 'lucide-react'

const STATUSES = ['investigating','identified','monitoring','resolved']

export default function IncidentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [incident, setIncident] = useState(null)
  const [updateForm, setUpdateForm] = useState({ status: 'investigating', message: '' })
  const [posting, setPosting] = useState(false)

  const load = () => incidentsApi.get(id).then(r => { setIncident(r.data); setUpdateForm(f => ({ ...f, status: r.data.status })) }).catch(() => navigate('/incidents'))
  useEffect(() => { load() }, [id])

  const handleUpdate = async (e) => {
    e.preventDefault()
    setPosting(true)
    try {
      await incidentsApi.addUpdate(id, updateForm)
      toast.success('Aggiornamento aggiunto')
      setUpdateForm(f => ({ ...f, message: '' }))
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Errore') }
    finally { setPosting(false) }
  }

  if (!incident) return <Layout title="Incidente"><div className="text-center py-16 text-gray-500">Caricamento...</div></Layout>

  return (
    <Layout title={incident.title}>
      <div className="max-w-3xl space-y-6">
        <Link to="/incidents" className="flex items-center gap-1 text-gray-500 hover:text-gray-700 text-sm"><ArrowLeft size={16} />Incidenti</Link>

        <div className="card p-6 space-y-3">
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={incident.status} />
            <CriticalityBadge criticality={incident.severity} />
          </div>
          <p className="text-gray-600 dark:text-gray-300 text-sm">{incident.description}</p>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Aperto:</span> <strong>{format(new Date(incident.started_at), 'dd MMM yyyy HH:mm', { locale: it })}</strong></div>
            {incident.resolved_at && <div><span className="text-gray-500">Risolto:</span> <strong>{format(new Date(incident.resolved_at), 'dd MMM yyyy HH:mm', { locale: it })}</strong></div>}
          </div>
        </div>

        {/* Assets */}
        {incident.assets?.length > 0 && (
          <div className="card p-5">
            <h3 className="font-medium mb-3 text-sm">Asset coinvolti</h3>
            <div className="flex flex-wrap gap-2">
              {incident.assets.map(a => <Link key={a.id} to={`/assets/${a.id}`} className="text-sm text-brand-600 hover:underline">{a.name}</Link>)}
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="card p-5">
          <h3 className="font-medium mb-4">Timeline aggiornamenti</h3>
          <div className="space-y-4">
            {incident.updates?.map(u => (
              <div key={u.id} className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-brand-500 mt-2 shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge status={u.status} />
                    <span className="text-xs text-gray-400">{format(new Date(u.created_at), 'dd/MM HH:mm', { locale: it })} · {u.author || '—'}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{u.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Add update */}
        {incident.status !== 'resolved' && (
          <div className="card p-5">
            <h3 className="font-medium mb-4 text-sm">Aggiungi aggiornamento</h3>
            <form onSubmit={handleUpdate} className="space-y-3">
              <select className="input" value={updateForm.status} onChange={e => setUpdateForm(f => ({ ...f, status: e.target.value }))}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <textarea className="input" rows={3} required placeholder="Messaggio..." value={updateForm.message}
                onChange={e => setUpdateForm(f => ({ ...f, message: e.target.value }))} />
              <div className="flex justify-end">
                <button type="submit" disabled={posting} className="btn-primary">{posting ? 'Invio...' : 'Pubblica'}</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  )
}
