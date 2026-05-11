import { useState, useEffect } from 'react'
import { statusApi } from '../api'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { CheckCircle, AlertTriangle, XCircle, Clock, Wrench } from 'lucide-react'

const OVERALL_ICONS = {
  operational: <CheckCircle className="text-green-500" size={28} />,
  degraded: <AlertTriangle className="text-yellow-500" size={28} />,
  major_outage: <XCircle className="text-red-500" size={28} />,
  under_maintenance: <Wrench className="text-blue-500" size={28} />,
}

const OVERALL_LABELS = {
  operational: 'Tutti i sistemi operativi',
  degraded: 'Degradato — Alcuni sistemi con problemi',
  major_outage: 'Interruzione maggiore',
  under_maintenance: 'Manutenzione in corso',
}

const STATUS_DOT = {
  operational: 'bg-green-500', degraded: 'bg-yellow-500',
  partial_outage: 'bg-orange-500', major_outage: 'bg-red-500',
  under_maintenance: 'bg-blue-500', unknown: 'bg-gray-400',
}

export default function StatusPage() {
  const [data, setData] = useState(null)

  useEffect(() => {
    statusApi.overview().then(r => setData(r.data)).catch(() => {})
    const timer = setInterval(() => statusApi.overview().then(r => setData(r.data)).catch(() => {}), 60000)
    return () => clearInterval(timer)
  }, [])

  if (!data) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2">{data.app_name}</h1>
          <p className="text-sm text-gray-500">Aggiornato: {format(new Date(data.last_updated), 'dd MMM yyyy HH:mm', { locale: it })}</p>
        </div>

        {/* Overall status */}
        <div className="card p-6 flex items-center gap-4">
          {OVERALL_ICONS[data.overall_status] || OVERALL_ICONS.operational}
          <span className="text-xl font-semibold">{OVERALL_LABELS[data.overall_status] || data.overall_status}</span>
        </div>

        {/* Services */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 font-semibold">Servizi</div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {data.services.map(s => (
              <div key={s.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[s.status] || STATUS_DOT.unknown}`} />
                  <span className="font-medium text-sm">{s.name}</span>
                </div>
                <span className="text-xs text-gray-500 capitalize">{s.status?.replace(/_/g, ' ')}</span>
              </div>
            ))}
            {data.services.length === 0 && <p className="text-center text-gray-500 py-6 text-sm">Nessun servizio pubblico</p>}
          </div>
        </div>

        {/* Active Incidents */}
        {data.active_incidents?.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 font-semibold text-red-600">Incidenti attivi</div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.active_incidents.map(i => (
                <div key={i.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-sm">{i.title}</p>
                    <span className="text-xs badge bg-red-100 text-red-800">{i.severity}</span>
                  </div>
                  <p className="text-xs text-gray-500">{i.description}</p>
                  <p className="text-xs text-gray-400 mt-1">{format(new Date(i.started_at), 'dd MMM HH:mm', { locale: it })}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming Maintenance */}
        {data.upcoming_maintenance?.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 font-semibold text-blue-600 flex items-center gap-2">
              <Clock size={16} /> Manutenzioni programmate
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.upcoming_maintenance.map(m => (
                <div key={m.id} className="px-5 py-4">
                  <p className="font-medium text-sm">{m.title}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {format(new Date(m.scheduled_start), 'dd MMM yyyy HH:mm', { locale: it })} → {format(new Date(m.scheduled_end), 'HH:mm', { locale: it })}
                  </p>
                  {m.description && <p className="text-xs text-gray-400 mt-1">{m.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
