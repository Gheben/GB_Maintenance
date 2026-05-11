import { useState, useEffect } from 'react'
import { statusApi } from '../api'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { CheckCircle, AlertTriangle, XCircle, Clock, Wrench, Users, ChevronDown, ChevronUp } from 'lucide-react'

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

function fmt(dt, f = 'dd MMM yyyy HH:mm') {
  if (!dt) return '—'
  try { return format(new Date(dt), f, { locale: it }) } catch { return '—' }
}

function MaintenanceCard({ m, colorClass }) {
  const [expanded, setExpanded] = useState(false)
  const users = m.involved_users || []
  return (
    <div className="px-4 sm:px-5 py-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="font-medium text-sm">{m.title}</p>
        <span className={`text-xs badge ${colorClass} shrink-0`}>
          {m.status === 'in_progress' ? 'In corso' : m.status === 'completed' ? 'Completata' : 'Programmata'}
        </span>
      </div>
      <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {m.status === 'in_progress' && m.actual_start && (
          <span>Avviata: {fmt(m.actual_start)}</span>
        )}
        {m.status === 'completed' && m.actual_end && (
          <span>Terminata: {fmt(m.actual_end)}</span>
        )}
        {m.status === 'scheduled' && m.scheduled_start && (
          <span>{fmt(m.scheduled_start)} → {fmt(m.scheduled_end, 'HH:mm dd MMM')}</span>
        )}
        {m.impact_level && <span className="capitalize">Impatto: {m.impact_level.replace(/_/g, ' ')}</span>}
      </div>
      {m.description && <p className="text-xs text-gray-400 mt-1">{m.description}</p>}
      {m.notes && <p className="text-xs text-gray-400 mt-1 italic">{m.notes}</p>}
      {users.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors"
          >
            <Users size={13} />
            Utenti coinvolti ({users.length})
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {expanded && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {users.map(u => (
                <span key={u.user_id} className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-full">
                  {u.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
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

  const inProgress = data.in_progress_maintenance || []
  const upcoming = data.upcoming_maintenance || []
  const recent = data.recent_maintenance || []

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 sm:py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{data.app_name}</h1>
          <p className="text-sm text-gray-500">Aggiornato: {fmt(data.last_updated)}</p>
        </div>

        {/* Overall status */}
        <div className="card p-5 sm:p-6 flex items-center gap-4">
          {OVERALL_ICONS[data.overall_status] || OVERALL_ICONS.operational}
          <span className="text-lg sm:text-xl font-semibold">{OVERALL_LABELS[data.overall_status] || data.overall_status}</span>
        </div>

        {/* Services */}
        <div className="card overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-gray-700 font-semibold">Servizi</div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {data.services.map(s => (
              <div key={s.id} className="flex items-center justify-between px-4 sm:px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT[s.status] || STATUS_DOT.unknown}`} />
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
            <div className="px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-gray-700 font-semibold text-red-600">Incidenti attivi</div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.active_incidents.map(i => (
                <div key={i.id} className="px-4 sm:px-5 py-4">
                  <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
                    <p className="font-medium text-sm">{i.title}</p>
                    <span className="text-xs badge bg-red-100 text-red-800 shrink-0">{i.severity}</span>
                  </div>
                  <p className="text-xs text-gray-500">{i.description}</p>
                  <p className="text-xs text-gray-400 mt-1">{fmt(i.started_at, 'dd MMM HH:mm')}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* In-progress Maintenance */}
        {inProgress.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-gray-700 font-semibold text-orange-600 flex items-center gap-2">
              <Wrench size={16} /> Manutenzione in corso
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {inProgress.map(m => (
                <MaintenanceCard key={m.id} m={m} colorClass="bg-orange-100 text-orange-800" />
              ))}
            </div>
          </div>
        )}

        {/* Upcoming Maintenance */}
        {upcoming.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-gray-700 font-semibold text-blue-600 flex items-center gap-2">
              <Clock size={16} /> Manutenzioni programmate
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {upcoming.map(m => (
                <MaintenanceCard key={m.id} m={m} colorClass="bg-blue-100 text-blue-800" />
              ))}
            </div>
          </div>
        )}

        {/* Recently Completed Maintenance */}
        {recent.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-gray-700 font-semibold text-gray-600 flex items-center gap-2">
              <CheckCircle size={16} className="text-green-500" /> Manutenzioni recenti
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {recent.map(m => (
                <MaintenanceCard key={m.id} m={m} colorClass="bg-green-100 text-green-800" />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
