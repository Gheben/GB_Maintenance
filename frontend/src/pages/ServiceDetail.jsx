import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { servicesApi } from '../api'
import { StatusBadge } from '../components/StatusBadge'
import { Modal, ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Server, Trash2, Plus, ExternalLink } from 'lucide-react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'

export default function ServiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [service, setService] = useState(null)
  const [uptime, setUptime] = useState([])
  const [showDelete, setShowDelete] = useState(false)

  const load = () => {
    servicesApi.get(id).then(r => setService(r.data))
    servicesApi.uptime(id).then(r => setUptime(r.data))
  }
  useEffect(() => { load() }, [id])

  const handleDelete = async () => {
    try { await servicesApi.delete(id); toast.success('Servizio eliminato'); navigate('/services') }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  if (!service) return <Layout title="Servizio"><p className="text-gray-500">Caricamento...</p></Layout>

  return (
    <Layout title={service.name}>
      <div className="max-w-4xl space-y-6">
        {/* Info card */}
        <div className="card p-6 flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-brand-600 flex items-center justify-center text-white flex-shrink-0">
            <Server size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-xl font-bold">{service.name}</h2>
              <StatusBadge status={service.current_status} />
            </div>
            {service.description && <p className="text-gray-500 mt-1">{service.description}</p>}
            <div className="flex flex-wrap gap-6 mt-3 text-sm text-gray-600">
              {service.sla_target && <span>SLA target: <strong>{service.sla_target}%</strong></span>}
              {service.url && <a href={service.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-brand-600 hover:underline"><ExternalLink size={13} />{service.url}</a>}
              {service.slug && <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{service.slug}</span>}
            </div>
          </div>
          <button className="p-2 text-red-500 hover:bg-red-50 rounded-lg" onClick={() => setShowDelete(true)}><Trash2 size={18} /></button>
        </div>

        {/* Uptime chart */}
        {uptime.length > 0 && (
          <div className="card p-4">
            <h3 className="font-semibold mb-4">Uptime ultimi 30 giorni</h3>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={uptime}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => format(new Date(d), 'dd/MM', { locale: it })} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <Tooltip formatter={(v) => [`${v}%`, 'Uptime']} />
                <Area type="monotone" dataKey="uptime_pct" stroke="#3b82f6" fill="#93c5fd" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Assets */}
        {service.assets && service.assets.length > 0 && (
          <div className="card p-4">
            <h3 className="font-semibold mb-3">Asset collegati ({service.assets.length})</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {service.assets.map(a => (
                <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <StatusBadge status={a.current_status} />
                  <span className="text-sm font-medium">{a.name}</span>
                  <span className="text-xs text-gray-400 ml-auto">{a.asset_type}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showDelete && <ConfirmDialog title="Elimina Servizio" message={`Eliminare "${service.name}"?`} danger confirmLabel="Elimina" onConfirm={handleDelete} onCancel={() => setShowDelete(false)} />}
    </Layout>
  )
}
