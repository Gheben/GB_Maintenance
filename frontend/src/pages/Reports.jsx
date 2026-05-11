import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { reportsApi } from '../api'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { Download } from 'lucide-react'
import { StatusBadge } from '../components/StatusBadge'

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
    const a = document.createElement('a'); a.href = url; a.download = 'manutenzioni.csv'; a.click()
  }
  const downloadPdf = () => {
    const url = `/api/reports/maintenance?from=${from}&to=${to}&format=pdf`
    window.open(url)
  }

  return (
    <Layout title="Report">
      <div className="max-w-5xl space-y-4">
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {[['maintenance','Manutenzioni'],['uptime','Uptime servizi'],['assets','Asset']].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm font-medium ${tab === k ? 'border-b-2 border-brand-600 text-brand-600' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
          ))}
        </div>

        {tab === 'maintenance' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div><label className="block text-xs font-medium mb-1">Da</label><input type="datetime-local" className="input" value={from} onChange={e => setFrom(e.target.value)} /></div>
              <div><label className="block text-xs font-medium mb-1">A</label><input type="datetime-local" className="input" value={to} onChange={e => setTo(e.target.value)} /></div>
              <button className="btn-primary" onClick={load}>Aggiorna</button>
              <button className="btn-secondary" onClick={downloadCsv}><Download size={14} />CSV</button>
              <button className="btn-secondary" onClick={downloadPdf}><Download size={14} />PDF</button>
            </div>

            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>{['Titolo','Tipo','Impatto','Stato','Inizio','Durata (min)'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {data.map(m => (
                    <tr key={m.id}>
                      <td className="px-4 py-2">{m.title}</td>
                      <td className="px-4 py-2 text-gray-500">{m.type}</td>
                      <td className="px-4 py-2">{m.impact_level}</td>
                      <td className="px-4 py-2"><StatusBadge status={m.status} /></td>
                      <td className="px-4 py-2 text-gray-500">{format(new Date(m.scheduled_start), 'dd/MM HH:mm', { locale: it })}</td>
                      <td className="px-4 py-2 text-gray-500">{Math.round(m.duration_minutes || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'uptime' && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>{['Servizio','Stato','SLA %','Outage events (30gg)'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
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
      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-700/50">
          <tr>{['Nome','Categoria','Criticità','Stato','Manutenzioni','Incidenti','Probe fail 30gg'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
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
  )
}
