import { useEffect, useState } from 'react'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { reportsApi } from '../api'
import { format } from 'date-fns'
import { AlertTriangle, Package, Server, CalendarClock } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts'

const ASSET_STATUS_COLORS = {
  operational: '#10b981', degraded: '#f59e0b',
  partial_outage: '#f97316', major_outage: '#ef4444',
  under_maintenance: '#6366f1', unknown: '#6b7280',
}
const CRIT_COLORS = { critical: '#ef4444', high: '#f97316', medium: '#f59e0b', low: '#10b981' }
const TYPE_COLORS_MAP = {
  planned: '#3b82f6', emergency: '#ef4444', upgrade: '#10b981',
  security_patch: '#f59e0b', infrastructure: '#8b5cf6', other: '#6b7280',
}
const STATUS_BAR_COLORS = {
  draft: '#6b7280', pending_approval: '#f59e0b', approved: '#3b82f6',
  in_progress: '#f97316', completed: '#10b981', cancelled: '#9ca3af',
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

const ChartTip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg p-2 text-xs shadow">
      <p className="font-medium capitalize">{payload[0].name || payload[0].dataKey}</p>
      <p className="text-gray-600 dark:text-gray-300">{payload[0].value}</p>
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [upcomingPage, setUpcomingPage] = useState(1)
  const [recentPage, setRecentPage] = useState(1)
  const maintenancePageSize = 5

  useEffect(() => {
    reportsApi.dashboard({
      upcoming_page: upcomingPage,
      upcoming_limit: maintenancePageSize,
      recent_page: recentPage,
      recent_limit: maintenancePageSize,
    }).then(r => setData(r.data)).catch(() => {})
  }, [upcomingPage, recentPage])

  const assetStatusData = (data?.assets_by_status || []).map(s => ({
    name: s.status.replace(/_/g, ' '), value: s.count, color: ASSET_STATUS_COLORS[s.status] || '#6b7280'
  }))
  const assetCritData = (data?.assets_by_criticality || []).map(s => ({
    name: s.criticality, value: s.count, fill: CRIT_COLORS[s.criticality] || '#6b7280'
  }))
  const mTypeData = (data?.maintenance_by_type || []).map(s => ({
    name: s.type.replace(/_/g, ' '), value: s.count, fill: TYPE_COLORS_MAP[s.type] || '#6366f1'
  }))
  const mStatusData = (data?.maintenance_by_status || []).map(s => ({
    name: s.status.replace(/_/g, ' '), value: s.count, fill: STATUS_BAR_COLORS[s.status] || '#6b7280'
  }))
  const upcomingList = data?.upcoming_maintenance || []
  const recentList = data?.recent_completed || []
  const upcomingTotal = Number(data?.upcoming_maintenance_total || 0)
  const recentTotal = Number(data?.recent_completed_total || 0)
  const upcomingTotalPages = Math.max(1, Math.ceil(upcomingTotal / maintenancePageSize))
  const recentTotalPages = Math.max(1, Math.ceil(recentTotal / maintenancePageSize))

  return (
    <Layout title="Dashboard">
      <div className="space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={Package} label="Total Assets" value={data?.totals?.assets} color="blue" />
          <StatCard icon={Server} label="Services" value={data?.totals?.services} color="green" />
          <StatCard icon={CalendarClock} label="Active Maintenances" value={data?.totals?.active_maintenance} color="orange" />
          <StatCard icon={AlertTriangle} label="Open Incidents" value={data?.totals?.open_incidents} color="red" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-5">
            <h2 className="font-semibold mb-3 text-sm">Asset Status</h2>
            {assetStatusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={assetStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}>
                    {assetStatusData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                  <Legend iconType="circle" iconSize={9} formatter={v => <span className="text-xs capitalize">{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className="text-gray-400 text-sm text-center py-10">No data</p>}
          </div>

          <div className="card p-5">
            <h2 className="font-semibold mb-3 text-sm">Assets by Criticality</h2>
            {assetCritData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={assetCritData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="value" radius={[4,4,0,0]}>
                    {assetCritData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-gray-400 text-sm text-center py-10">No data</p>}
          </div>

          <div className="card p-5">
            <h2 className="font-semibold mb-0.5 text-sm">Maintenances by Type <span className="text-gray-400 font-normal text-xs">(last 90 days)</span></h2>
            {mTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={mTypeData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="value" radius={[4,4,0,0]}>
                    {mTypeData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-gray-400 text-sm text-center py-10">No data</p>}
          </div>

          <div className="card p-5">
            <h2 className="font-semibold mb-0.5 text-sm">Maintenances by Status <span className="text-gray-400 font-normal text-xs">(last 90 days)</span></h2>
            {mStatusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={mStatusData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="value" radius={[4,4,0,0]}>
                    {mStatusData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-gray-400 text-sm text-center py-10">No data</p>}
          </div>
        </div>

        {/* Upcoming + recent */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-5">
            <h2 className="font-semibold mb-4">Upcoming Maintenances</h2>
            {upcomingTotal === 0 && <p className="text-gray-500 text-sm">No scheduled maintenances</p>}
            <div className="space-y-3">
              {upcomingList.map(m => (
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
            {upcomingTotalPages > 1 && (
              <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  className="btn-secondary px-2 py-1"
                  disabled={upcomingPage <= 1}
                  onClick={() => setUpcomingPage(p => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <span className="text-gray-500">Page {upcomingPage} / {upcomingTotalPages}</span>
                <button
                  type="button"
                  className="btn-secondary px-2 py-1"
                  disabled={upcomingPage >= upcomingTotalPages}
                  onClick={() => setUpcomingPage(p => Math.min(upcomingTotalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            )}
          </div>

          <div className="card p-5">
            <h2 className="font-semibold mb-4">Recently Completed</h2>
            {recentTotal === 0 && <p className="text-gray-500 text-sm">None yet</p>}
            <div className="space-y-3">
              {recentList.map(m => (
                <Link key={m.id} to={`/maintenance/${m.id}`} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700">
                  <p className="text-sm font-medium">{m.title}</p>
                  <StatusBadge status={m.status} />
                </Link>
              ))}
            </div>
            {recentTotalPages > 1 && (
              <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  className="btn-secondary px-2 py-1"
                  disabled={recentPage <= 1}
                  onClick={() => setRecentPage(p => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <span className="text-gray-500">Page {recentPage} / {recentTotalPages}</span>
                <button
                  type="button"
                  className="btn-secondary px-2 py-1"
                  disabled={recentPage >= recentTotalPages}
                  onClick={() => setRecentPage(p => Math.min(recentTotalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
