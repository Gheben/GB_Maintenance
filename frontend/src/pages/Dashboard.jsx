import { useEffect, useState } from 'react'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { reportsApi } from '../api'
import { format } from 'date-fns'
import { AlertTriangle, Package, Server, CalendarClock } from 'lucide-react'
import { Link } from 'react-router-dom'

function StatCard({ icon: Icon, label, value, color = 'blue' }) {
  const colors = { blue: 'bg-blue-50 text-blue-700', red: 'bg-red-50 text-red-700', green: 'bg-green-50 text-green-700', orange: 'bg-orange-50 text-orange-700' }
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className={`rounded-xl p-3 ${colors[color]}`}><Icon size={24} /></div>
      <div>
        <p className="text-2xl font-bold">{value ?? '-'}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState(null)

  useEffect(() => {
    reportsApi.dashboard().then(r => setData(r.data)).catch(() => {})
  }, [])

  return (
    <Layout title="Dashboard">
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Package} label="Total Assets" value={data?.totals?.assets} color="blue" />
          <StatCard icon={Server} label="Services" value={data?.totals?.services} color="green" />
          <StatCard icon={CalendarClock} label="Active Maintenances" value={data?.totals?.active_maintenance} color="orange" />
          <StatCard icon={AlertTriangle} label="Open Incidents" value={data?.totals?.open_incidents} color="red" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upcoming maintenance */}
          <div className="card p-5">
            <h2 className="font-semibold mb-4">Upcoming Maintenances</h2>
            {data?.upcoming_maintenance?.length === 0 && <p className="text-gray-500 text-sm">No scheduled maintenances</p>}
            <div className="space-y-3">
              {data?.upcoming_maintenance?.map(m => (
                <Link key={m.id} to={`/maintenance/${m.id}`} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700">
                  <div>
                    <p className="text-sm font-medium">{m.title}</p>
                    <p className="text-xs text-gray-500">{format(new Date(m.scheduled_start), 'MMM dd yyyy HH:mm')}</p>
                  </div>
                  <div className="flex gap-2">
                    <CriticalityBadge criticality={m.impact_level} />
                    <StatusBadge status={m.status} />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Asset by status */}
          <div className="card p-5">
            <h2 className="font-semibold mb-4">Asset Status</h2>
            <div className="space-y-2">
              {data?.assets_by_status?.map(s => (
                <div key={s.status} className="flex items-center justify-between">
                  <StatusBadge status={s.status} />
                  <span className="font-semibold">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}


function StatCard({ icon: Icon, label, value, color = 'blue' }) {
  const colors = { blue: 'bg-blue-50 text-blue-700', red: 'bg-red-50 text-red-700', green: 'bg-green-50 text-green-700', orange: 'bg-orange-50 text-orange-700' }
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className={`rounded-xl p-3 ${colors[color]}`}><Icon size={24} /></div>
      <div>
        <p className="text-2xl font-bold">{value ?? '-'}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState(null)

  useEffect(() => {
    reportsApi.dashboard().then(r => setData(r.data)).catch(() => {})
  }, [])

  return (
    <Layout title="Dashboard">
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Package} label="Asset totali" value={data?.totals?.assets} color="blue" />
          <StatCard icon={Server} label="Servizi" value={data?.totals?.services} color="green" />
          <StatCard icon={CalendarClock} label="Manutenzioni attive" value={data?.totals?.active_maintenance} color="orange" />
          <StatCard icon={AlertTriangle} label="Incidenti aperti" value={data?.totals?.open_incidents} color="red" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Upcoming maintenance */}
          <div className="card p-5">
            <h2 className="font-semibold mb-4">Prossime manutenzioni</h2>
            {data?.upcoming_maintenance?.length === 0 && <p className="text-gray-500 text-sm">Nessuna manutenzione pianificata</p>}
            <div className="space-y-3">
              {data?.upcoming_maintenance?.map(m => (
                <Link key={m.id} to={`/maintenance/${m.id}`} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700">
                  <div>
                    <p className="text-sm font-medium">{m.title}</p>
                    <p className="text-xs text-gray-500">{format(new Date(m.scheduled_start), 'dd MMM yyyy HH:mm', { locale: it })}</p>
                  </div>
                  <div className="flex gap-2">
                    <CriticalityBadge criticality={m.impact_level} />
                    <StatusBadge status={m.status} />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Asset by status */}
          <div className="card p-5">
            <h2 className="font-semibold mb-4">Stato asset</h2>
            <div className="space-y-2">
              {data?.assets_by_status?.map(s => (
                <div key={s.status} className="flex items-center justify-between">
                  <StatusBadge status={s.status} />
                  <span className="font-semibold">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
