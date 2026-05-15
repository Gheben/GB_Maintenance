import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { reportsApi } from '../api'
import { format } from 'date-fns'
import { Download } from 'lucide-react'
import { StatusBadge } from '../components/StatusBadge'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  ResponsiveContainer, LineChart, Line, Legend
} from 'recharts'

const ChartTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg p-2 text-xs shadow">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p, i) => <p key={i} style={{ color: p.color || p.fill }}>{p.name}: {p.value}</p>)}
    </div>
  )
}

export default function Reports() {
  const [tab, setTab] = useState('maintenance')
  const [from, setFrom] = useState(format(new Date(Date.now() - 30 * 86400000), "yyyy-MM-dd'T'HH:mm"))
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"))
  const [data, setData] = useState([])
  const [uptimeData, setUptimeData] = useState([])

  const load = () => {
    if (tab === 'maintenance') {
      reportsApi.maintenance({ from, to }).then(r => setData(r.data))
    } else if (tab === 'uptime') {
      reportsApi.uptime({ days: 30 }).then(r => setUptimeData(r.data))
    }
  }

  useEffect(() => { load() }, [tab])

  const downloadCsv = () => {
    const url = `/api/reports/maintenance?from=${from}&to=${to}&format=csv`
    const a = document.createElement('a'); a.href = url; a.download = 'maintenance.csv'; a.click()
  }
  const downloadPdf = () => {
    const url = `/api/reports/maintenance?from=${from}&to=${to}&format=pdf`
    window.open(url)
  }

  return (
    <Layout title="Reports">
      <div className="space-y-4">
        <div className="py-2 -mx-4 sm:mx-0 px-4 sm:px-0 border-b border-gray-200 dark:border-gray-700">
          <nav className="flex flex-wrap gap-1.5">
            {[['maintenance','Maintenance'],['uptime','Service Uptime'],['assets','Assets']].map(([k,l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-full transition-colors ${
                  tab === k ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-200'
                }`}>{l}</button>
            ))}
          </nav>
        </div>

        {tab === 'maintenance' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <div className="min-w-0"><label className="block text-xs font-medium mb-1">From</label><input type="datetime-local" className="input w-full" value={from} onChange={e => setFrom(e.target.value)} /></div>
              <div className="min-w-0"><label className="block text-xs font-medium mb-1">To</label><input type="datetime-local" className="input w-full" value={to} onChange={e => setTo(e.target.value)} /></div>
              <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-1 xl:justify-end">
                <button className="btn-primary" onClick={load}>Refresh</button>
                <button className="btn-secondary" onClick={downloadCsv}><Download size={14} />CSV</button>
                <button className="btn-secondary" onClick={downloadPdf}><Download size={14} />PDF</button>
              </div>
            </div>

            {/* Chart: avg duration by type */}
            {data.length > 0 && (() => {
              const byType = {}
              data.forEach(m => {
                if (!byType[m.type]) byType[m.type] = { count: 0, total: 0 }
                byType[m.type].count++
                byType[m.type].total += m.duration_minutes || 0
              })
              const chartData = Object.entries(byType).map(([type, v]) => ({
                name: type.replace(/_/g, ' '),
                avg: Math.round(v.total / v.count),
                count: v.count,
              }))
              return (
                <div className="card p-5">
                  <h2 className="font-semibold mb-3 text-sm">Avg Duration by Type (min)</h2>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <Tooltip content={<ChartTip />} />
                      <Bar dataKey="avg" name="avg min" radius={[4,4,0,0]} fill="#6366f1" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )
            })()}

            <div className="card overflow-hidden">
              <div className="overflow-auto" style={{ maxHeight: '62.5rem' }}>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>{['Title','Type','Impact','Status','Start','Duration (min)'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {data.map(m => (
                      <tr key={m.id}>
                        <td className="px-4 py-2">{m.title}</td>
                        <td className="px-4 py-2 text-gray-500">{m.type}</td>
                        <td className="px-4 py-2">{m.impact_level}</td>
                        <td className="px-4 py-2"><StatusBadge status={m.status} /></td>
                        <td className="px-4 py-2 text-gray-500">{format(new Date(m.scheduled_start), 'MM/dd HH:mm')}</td>
                        <td className="px-4 py-2 text-gray-500">{Math.round(m.duration_minutes || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.length > 25 && (
                <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100 dark:border-gray-700">
                  Showing 25 rows at a time. Scroll to view more.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'uptime' && (
          <div className="space-y-4">
            {/* Bar chart: SLA % */}
            {uptimeData.length > 0 && (
              <div className="card p-5">
                <h2 className="font-semibold mb-3 text-sm">Service SLA %</h2>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={uptimeData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="sla_uptime_percent" name="SLA %" radius={[4,4,0,0]} fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="card overflow-hidden">
              <div className="overflow-auto" style={{ maxHeight: '62.5rem' }}>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>{['Service','Status','SLA %','Outage events (30d)'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {uptimeData.map(s => (
                      <tr key={s.id}>
                        <td className="px-4 py-2 font-medium">{s.name}</td>
                        <td className="px-4 py-2"><StatusBadge status={s.status} /></td>
                        <td className="px-4 py-2">{s.sla_uptime_percent}%</td>
                        <td className="px-4 py-2">{s.outage_events || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {uptimeData.length > 25 && (
                <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100 dark:border-gray-700">
                  Showing 25 rows at a time. Scroll to view more.
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'assets' && <AssetReport />}
      </div>
    </Layout>
  )
}

function AssetReport() {
  const [data, setData] = useState([])
  useEffect(() => { reportsApi.assets().then(r => setData(r.data)) }, [])
  return (
    <div className="card overflow-hidden">
      <div className="overflow-auto" style={{ maxHeight: '62.5rem' }}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>{['Name','Category','Criticality','Status','Maintenances','Incidents','Probe fails (30d)'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {data.map(a => (
              <tr key={a.id}>
                <td className="px-4 py-2 font-medium">{a.name}</td>
                <td className="px-4 py-2 text-gray-500">{a.category}</td>
                <td className="px-4 py-2">{a.criticality}</td>
                <td className="px-4 py-2"><StatusBadge status={a.status} /></td>
                <td className="px-4 py-2">{a.maintenance_count}</td>
                <td className="px-4 py-2">{a.incident_count}</td>
                <td className="px-4 py-2">{a.failed_probes_30d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length > 25 && (
        <div className="px-4 py-2 text-xs text-gray-500 border-t border-gray-100 dark:border-gray-700">
          Showing 25 rows at a time. Scroll to view more.
        </div>
      )}
    </div>
  )
}
