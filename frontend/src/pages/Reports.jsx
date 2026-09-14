import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { reportsApi } from '../api'
import { format } from 'date-fns'
import { Download, ShieldCheck } from 'lucide-react'
import { StatusBadge } from '../components/StatusBadge'
import { Pagination } from '../components/Pagination'
import { toast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
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
  const { hasPermission } = useAuth()
  const canAssets = hasPermission('assets')
  const canServices = hasPermission('services')
  const canLicenses = hasPermission('maintenance')
  const [tab, setTab] = useState('maintenance')
  const [exportFormat, setExportFormat] = useState('csv')
  const [licenseData, setLicenseData] = useState([])
  const [licenseTotal, setLicenseTotal] = useState(0)
  const [licensePage, setLicensePage] = useState(1)
  const [from, setFrom] = useState(format(new Date(Date.now() - 30 * 86400000), "yyyy-MM-dd'T'HH:mm"))
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"))
  const [data, setData] = useState([])
  const [uptimeData, setUptimeData] = useState([])

  const load = () => {
    if (tab === 'maintenance') {
      reportsApi.maintenance({ from, to }).then(r => setData(r.data))
    } else if (tab === 'uptime') {
      reportsApi.uptime({ days: 30 }).then(r => setUptimeData(r.data))
    } else if (tab === 'licenses' && canLicenses) {
      reportsApi.licenses({ page: licensePage, limit: 25 }).then(r => {
        const payload = r.data || {}
        setLicenseData(payload.data || [])
        setLicenseTotal(payload.total || 0)
      }).catch(() => {})
    }
  }

  useEffect(() => { load() }, [tab, licensePage])

  const triggerBlobDownload = (blob, fileName) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const triggerReportDownload = (blob, baseName, extension) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${baseName}-${format(new Date(), 'yyyyMMdd-HHmm')}.${extension}`
    link.click()
    URL.revokeObjectURL(url)
  }

  const downloadMaintenanceReport = async () => {
    try {
      const res = exportFormat === 'pdf'
        ? await reportsApi.maintenanceExportPdf({ from, to })
        : exportFormat === 'xlsx'
          ? await reportsApi.maintenanceExportXlsx({ from, to })
          : await reportsApi.maintenanceExportCsv({ from, to })
      triggerReportDownload(res.data, 'maintenance', exportFormat === 'xlsx' ? 'xlsx' : exportFormat)
    } catch (err) { toast.error(err.response?.data?.error || 'Maintenance report export failed')
    }
  }

  const downloadEntityReport = async (entity) => {
    try {
      const res = entity === 'licenses'
        ? await reportsApi.licensesExport(exportFormat)
        : entity === 'services'
          ? await reportsApi.servicesExport(exportFormat)
          : await reportsApi.assetsExport(exportFormat)
      triggerReportDownload(res.data, entity, exportFormat === 'xlsx' ? 'xlsx' : exportFormat)
    } catch (err) { toast.error(err.response?.data?.error || `${entity} report export failed`)
    }
  }

  return (
    <Layout title="Reports">
      <div className="space-y-4">
        <div className="py-2 -mx-4 sm:mx-0 px-4 sm:px-0 border-b border-gray-200 dark:border-gray-700">
          <nav className="flex flex-wrap gap-1.5">
            {[['maintenance','Maintenance'],['uptime','Service Uptime'],...(canAssets ? [['assets','Assets']] : []),...(canServices ? [['services','Services']] : []),...(canLicenses ? [['licenses','Licenses']] : [])].map(([k,l]) => (
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
                <select className="input w-32" value={exportFormat} onChange={e => setExportFormat(e.target.value)}><option value="csv">CSV</option><option value="xlsx">Excel</option><option value="pdf">PDF</option></select>
                <button className="btn-secondary" onClick={downloadMaintenanceReport}><Download size={14} />Export</button>
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

        {tab === 'assets' && <AssetReport exportFormat={exportFormat} setExportFormat={setExportFormat} onExport={() => downloadEntityReport('assets')} />}
        {tab === 'services' && <ServiceReport exportFormat={exportFormat} setExportFormat={setExportFormat} onExport={() => downloadEntityReport('services')} />}
        {tab === 'licenses' && <LicenseReport data={licenseData} total={licenseTotal} page={licensePage} onPageChange={setLicensePage} exportFormat={exportFormat} setExportFormat={setExportFormat} onExport={() => downloadEntityReport('licenses')} />}
      </div>
    </Layout>
  )
}

function AssetReport({ exportFormat, setExportFormat, onExport }) {
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  useEffect(() => {
    reportsApi.assets({ page, limit: 25 }).then(r => {
      setData(r.data?.data || [])
      setTotal(r.data?.total || 0)
    })
  }, [page])
  return (
    <div className="card overflow-hidden">
      <div className="flex justify-end gap-2 p-4 border-b border-gray-100 dark:border-gray-700"><select className="input w-32" value={exportFormat} onChange={e => setExportFormat(e.target.value)}><option value="csv">CSV</option><option value="xlsx">Excel</option><option value="pdf">PDF</option></select><button className="btn-secondary" onClick={onExport}><Download size={14} />Export</button></div>
      <div className="overflow-auto" style={{ maxHeight: '62.5rem' }}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>{['Name','Part-IS','Category','Criticality','Status','Maintenances','Incidents','Probe fails (30d)'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {data.map(a => (
              <tr key={a.id}>
                <td className="px-4 py-2 font-medium">{a.name}</td>
                <td className="px-4 py-2">{a.part_is_relevant ? <ShieldCheck size={17} className="text-amber-600" title="Part-IS Relevant" /> : <span className="text-gray-300">—</span>}</td>
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
      <div className="p-4 border-t border-gray-100 dark:border-gray-700"><Pagination page={page} limit={25} total={total} onChange={setPage} /></div>
    </div>
  )
}

function ServiceReport({ exportFormat, setExportFormat, onExport }) {
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  useEffect(() => {
    reportsApi.services({ page, limit: 25 }).then(r => {
      setData(r.data?.data || [])
      setTotal(r.data?.total || 0)
    })
  }, [page])
  return (
    <div className="card overflow-hidden">
      <div className="flex justify-end gap-2 p-4 border-b border-gray-100 dark:border-gray-700"><select className="input w-32" value={exportFormat} onChange={e => setExportFormat(e.target.value)}><option value="csv">CSV</option><option value="xlsx">Excel</option><option value="pdf">PDF</option></select><button className="btn-secondary" onClick={onExport}><Download size={14} />Export</button></div>
      <div className="overflow-auto" style={{ maxHeight: '62.5rem' }}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50"><tr>{['Name','Part-IS','Criticality','Status','SLA %','Assets','Maintenances','Incidents'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">{data.map(s => <tr key={s.id}><td className="px-4 py-2 font-medium">{s.name}</td><td className="px-4 py-2">{s.part_is_relevant ? <ShieldCheck size={17} className="text-amber-600" title="Part-IS Relevant" /> : <span className="text-gray-300">—</span>}</td><td className="px-4 py-2">{s.criticality}</td><td className="px-4 py-2"><StatusBadge status={s.status} /></td><td className="px-4 py-2">{s.sla_uptime_percent}%</td><td className="px-4 py-2">{s.asset_count}</td><td className="px-4 py-2">{s.maintenance_count}</td><td className="px-4 py-2">{s.incident_count}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="p-4 border-t border-gray-100 dark:border-gray-700"><Pagination page={page} limit={25} total={total} onChange={setPage} /></div>
    </div>
  )
}

function licenseExpiryMeta(expiryDate, reminderDays = 30) {
  if (!expiryDate) return { label: 'No expiry', className: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' }
  const expiry = new Date(expiryDate)
  if (Number.isNaN(expiry.getTime())) return { label: expiryDate, className: 'bg-gray-100 text-gray-600' }
  const days = Math.ceil((expiry.setHours(23, 59, 59, 999) - Date.now()) / 86400000)
  if (days < 0) return { label: 'Expired', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' }
  if (days <= Number(reminderDays || 30)) return { label: 'Expiring', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' }
  return { label: 'Valid', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' }
}

function LicenseReport({ data, total, page, onPageChange, exportFormat, setExportFormat, onExport }) {
  return <div className="card overflow-hidden"><div className="flex justify-end gap-2 p-4 border-b border-gray-100 dark:border-gray-700"><select className="input w-32" value={exportFormat} onChange={e => setExportFormat(e.target.value)}><option value="csv">CSV</option><option value="xlsx">Excel</option><option value="pdf">PDF</option></select><button className="btn-secondary" onClick={onExport}><Download size={14} />Export</button></div><div className="overflow-auto"><table className="w-full text-sm"><thead className="bg-gray-50 dark:bg-gray-700/50"><tr>{['Name','Approval status','Expiry date','Renewal date','Supplier','Cost','Assets','Services'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-700">{data.map(row => { const expiry = licenseExpiryMeta(row.expiry_date, row.reminder_days); return <tr key={`${row.name}-${row.expiry_date}`}><td className="px-4 py-2 font-medium">{row.name}</td><td className="px-4 py-2">{row.approval_status}</td><td className="px-4 py-2"><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${expiry.className}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{row.expiry_date || expiry.label}</span></td><td className="px-4 py-2">{row.renewal_date || '—'}</td><td className="px-4 py-2">{row.supplier || row.supplier_company || '—'}</td><td className="px-4 py-2">{row.estimated_cost || '—'} {row.currency || ''}</td><td className="px-4 py-2">{row.asset_count || 0}</td><td className="px-4 py-2">{row.service_count || 0}</td></tr> })}</tbody></table></div><div className="p-4 border-t border-gray-100 dark:border-gray-700"><Pagination page={page} limit={25} total={total} onChange={onPageChange} /></div></div>
}
