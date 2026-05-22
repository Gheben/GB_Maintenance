import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { statusApi } from '../api'
import { format } from 'date-fns'
import { CheckCircle, AlertTriangle, XCircle, Clock, Wrench, Users, ChevronDown, ChevronUp, Search, Ban, Bell, Building2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { Modal } from '../components/Modal'
import { differenceInCalendarDays } from 'date-fns'

const OVERALL_ICONS = {
  operational: <CheckCircle className="text-green-500" size={28} />,
  degraded: <AlertTriangle className="text-yellow-500" size={28} />,
  major_outage: <XCircle className="text-red-500" size={28} />,
  under_maintenance: <Wrench className="text-blue-500" size={28} />,
}

const OVERALL_LABELS = {
  operational: 'All systems are operational',
  degraded: 'Degraded performance on some services',
  major_outage: 'Major outage in progress',
  under_maintenance: 'Maintenance activity in progress',
}

const STATUS_DOT = {
  operational: 'bg-green-500 animate-pulse', degraded: 'bg-yellow-500',
  partial_outage: 'bg-orange-500', major_outage: 'bg-red-500',
  under_maintenance: 'bg-blue-500', unknown: 'bg-gray-400',
}

const IMPACT_BADGE = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200',
}

function impactLabel(v) {
  return String(v || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Unknown'
}

function fmt(dt, f = 'MM/dd/yyyy HH:mm') {
  if (!dt) return '—'
  try { return format(new Date(dt), f) } catch { return '—' }
}

function MaintenanceCard({ m, colorClass }) {
  const [showUsersModal, setShowUsersModal] = useState(false)
  const [usersSearch, setUsersSearch] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [subscribed, setSubscribed] = useState(m.is_subscribed || false)
  const [subscribing, setSubscribing] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const { user } = useAuth()
  const isLoggedIn = !!user || !!localStorage.getItem('token')
  const users = m.involved_users || []
  // Subscribe is only offered for public maintenances with no user_targets
  const showSubscribeBtn = isLoggedIn && users.length === 0
  const uniqueOffices = [...new Set(users.map(u => u.office).filter(Boolean))]
  const filteredUsers = usersSearch.trim()
    ? users.filter(u => {
        const q = usersSearch.toLowerCase()
        return String(u.name || '').toLowerCase().includes(q)
          || String(u.office || '').toLowerCase().includes(q)
      })
    : users

  const handleSubscribe = async () => {
    setSubscribing(true)
    try {
      if (subscribed) {
        await statusApi.unsubscribeMaintenance(m.id)
        setSubscribed(false)
      } else {
        await statusApi.subscribeMaintenance(m.id)
        setSubscribed(true)
      }
    } catch { /* ignore */ }
    finally { setSubscribing(false) }
  }

  const handleBellClick = () => {
    if (window.matchMedia('(hover: none)').matches) {
      setShowConfirm(true)
    } else {
      handleSubscribe()
    }
  }

  const steps = [
    { label: 'Created',   ts: m.created_at,   color: 'bg-gray-400' },
    { label: 'Approved',  ts: m.approved_at,  color: 'bg-blue-500' },
    { label: 'Reopened',  ts: m.reopened_at,  color: 'bg-amber-500' },
    { label: 'Started',   ts: m.actual_start, color: 'bg-orange-500' },
    { label: 'Completed', ts: m.actual_end,   color: 'bg-green-500' },
  ]
  const hasHistory = steps.some(s => s.ts)

  return (
    <div className="px-4 sm:px-5 py-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="font-medium text-sm">{m.title}</p>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs badge ${colorClass}`}>
            {m.status === 'in_progress' ? 'In Progress' : m.status === 'completed' ? 'Completed' : 'Scheduled'}
          </span>
          {m.impact_level && (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${IMPACT_BADGE[m.impact_level] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
              Impact: {impactLabel(m.impact_level)}
            </span>
          )}
        </div>
      </div>
      <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {m.status === 'in_progress' && m.actual_start && (
          <span>Started: {fmt(m.actual_start)}</span>
        )}
        {m.status === 'completed' && m.actual_end && (
          <span>Finished: {fmt(m.actual_end)}</span>
        )}
        {m.status === 'scheduled' && m.scheduled_start && (
          <span>{fmt(m.scheduled_start)} → {fmt(m.scheduled_end, 'HH:mm MM/dd')}</span>
        )}
      </div>
      {m.description && <p className="text-xs text-gray-400 mt-1">{m.description}</p>}
      {m.notes && <p className="text-xs text-gray-400 mt-1 italic">{m.notes}</p>}
      {isLoggedIn && m.reopen_reason && <p className="text-xs text-amber-700 mt-1"><strong>Reopen reason:</strong> {m.reopen_reason}</p>}

      <div className="mt-2 flex flex-wrap gap-3">
        {hasHistory && (
          <button
            onClick={() => setShowHistory(v => !v)}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full border px-3 py-1.5 transition-colors ${
              showHistory
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'
                : 'bg-gray-50 dark:bg-gray-800/60 text-gray-500 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            <Clock size={12} />
            Timeline
          </button>
        )}
        {showSubscribeBtn && (
          <button
            onClick={handleBellClick}
            disabled={subscribing}
            className={`group inline-flex items-center overflow-hidden text-xs font-semibold rounded-full border px-2.5 py-1.5 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${
              subscribed
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                : 'bg-gradient-to-r from-brand-500 to-cyan-500 text-white border-transparent shadow-sm hover:shadow-md'
            }`}
            title={subscribed ? 'Unsubscribe from updates' : 'Subscribe for updates'}
          >
            <Bell
              size={14}
              className={`flex-shrink-0 group-hover:animate-wiggle ${
                subscribed ? 'fill-current' : ''
              }`}
            />
            <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out pl-0 group-hover:max-w-[160px] group-hover:pl-1.5">
              {subscribing ? 'Wait…' : subscribed ? 'Unsubscribe' : 'Subscribe for updates'}
            </span>
          </button>
        )}
      </div>

      {users.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            <Users size={11} />
            Involved users:
          </span>
          {isLoggedIn ? (
            <button
              type="button"
              onClick={() => { setUsersSearch(''); setShowUsersModal(true) }}
              className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 dark:bg-indigo-900/30 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 px-2.5 py-0.5 text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
              title="View involved users"
            >
              {users.length}
            </button>
          ) : (
            <span
              className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 text-gray-600 px-2.5 py-0.5 text-xs font-medium"
              title="Login required to view involved users details"
            >
              {users.length}
            </span>
          )}
        </div>
      )}

      {uniqueOffices.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            <Building2 size={11} />
            Affected offices:
          </span>
          {isLoggedIn ? (
            uniqueOffices.map(office => (
              <span
                key={office}
                className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 dark:bg-indigo-900/30 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 px-2.5 py-0.5 text-xs font-medium"
              >
                {office}
              </span>
            ))
          ) : (
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 text-gray-600 px-2.5 py-0.5 text-xs font-medium">
              {uniqueOffices.length}
            </span>
          )}
        </div>
      )}

      {showConfirm && (
        <Modal
          title={subscribed ? 'Unsubscribe from updates' : 'Subscribe for updates'}
          onClose={() => setShowConfirm(false)}
        >
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
            {subscribed
              ? `Stop receiving email notifications for \u201c${m.title}\u201d?`
              : `Receive email notifications for updates on \u201c${m.title}\u201d?`}
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowConfirm(false)}
              className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={() => { setShowConfirm(false); handleSubscribe() }}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white ${
                subscribed ? 'bg-red-500 hover:bg-red-600' : 'bg-brand-500 hover:bg-brand-600'
              }`}
            >
              {subscribed ? 'Unsubscribe' : 'Subscribe'}
            </button>
          </div>
        </Modal>
      )}

      {showHistory && (
        <div className="mt-3 flex flex-wrap items-center gap-0">
          {steps.map((step, idx) => (
            <div key={step.label} className="flex items-center">
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 rounded-full ${step.ts ? step.color : 'bg-gray-200'} flex-shrink-0`} />
                <span className={`text-xs font-medium mt-1 ${step.ts ? 'text-gray-700 dark:text-gray-200' : 'text-gray-300'}`}>{step.label}</span>
                {step.ts && <span className="text-xs text-gray-400">{fmt(step.ts, 'MM/dd HH:mm')}</span>}
              </div>
              {idx < steps.length - 1 && (
                <div className="w-12 h-px bg-gray-300 dark:bg-gray-600 mx-2 mb-5" />
              )}
            </div>
          ))}
        </div>
      )}

      {showUsersModal && isLoggedIn && (
        <Modal title={`Involved users (${users.length})`} onClose={() => setShowUsersModal(false)} size="md">
          <div className="space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-8"
                placeholder="Search user or office..."
                value={usersSearch}
                onChange={(e) => setUsersSearch(e.target.value)}
              />
            </div>
            <div className="max-h-72 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
              {filteredUsers.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">No users found</p>
              ) : (
                filteredUsers.map(u => (
                  <div key={u.user_id} className="px-3 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{u.name}</span>
                    {u.office && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 shrink-0">
                        {u.office}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

const PAGE_SIZE = 25

function MaintenanceList({ items, colorClass, title, icon, headerClass }) {
  const [search, setSearch] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)

  const filtered = search.trim()
    ? items.filter(m =>
        m.title?.toLowerCase().includes(search.toLowerCase()) ||
        m.description?.toLowerCase().includes(search.toLowerCase())
      )
    : items

  const shown = filtered.slice(0, visible)
  const hasMore = visible < filtered.length

  if (items.length === 0) return null

  return (
    <div className="card overflow-hidden">
      <div className={`px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-gray-700 font-semibold flex items-center justify-between gap-3 ${headerClass}`}>
        <span className="flex items-center gap-2">{icon}{title}</span>
        <span className="text-xs font-normal text-gray-400">{filtered.length} of {items.length}</span>
      </div>
      {items.length > PAGE_SIZE && (
        <div className="px-4 sm:px-5 py-2 border-b border-gray-100 dark:border-gray-700">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Search..."
              value={search}
              onChange={e => { setSearch(e.target.value); setVisible(PAGE_SIZE) }}
            />
          </div>
        </div>
      )}
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {shown.length === 0
          ? <p className="text-center text-gray-400 py-6 text-sm">No results</p>
          : shown.map(m => <MaintenanceCard key={m.id} m={m} colorClass={colorClass} />)
        }
      </div>
      {hasMore && (
        <div className="px-4 sm:px-5 py-3 border-t border-gray-100 dark:border-gray-700 text-center">
          <button
            className="text-sm text-brand-600 hover:text-brand-800 font-medium"
            onClick={() => setVisible(v => v + PAGE_SIZE)}
          >
            Show more ({filtered.length - visible} remaining)
          </button>
        </div>
      )}
    </div>
  )
}

function LatestListSection({ items, title, icon, headerClass, renderItem, emptyText = 'No results' }) {
  const [visible, setVisible] = useState(10)

  useEffect(() => {
    setVisible(10)
  }, [items])

  const shown = items.slice(0, visible)
  const hasMore = visible < items.length

  if (!items || items.length === 0) return null

  return (
    <div className="card overflow-hidden">
      <div className={`px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-gray-700 font-semibold flex items-center justify-between gap-3 ${headerClass}`}>
        <span className="flex items-center gap-2">{icon}{title}</span>
        <span className="text-xs font-normal text-gray-400">{shown.length} of {items.length}</span>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {shown.length === 0
          ? <p className="text-center text-gray-400 py-6 text-sm">{emptyText}</p>
          : shown.map(renderItem)
        }
      </div>
      {hasMore && (
        <div className="px-4 sm:px-5 py-3 border-t border-gray-100 dark:border-gray-700 text-center">
          <button
            className="text-sm text-brand-600 hover:text-brand-800 font-medium"
            onClick={() => setVisible(v => v + 10)}
          >
            View more ({items.length - visible} remaining)
          </button>
        </div>
      )}
    </div>
  )
}

function maintenanceDate(m) {
  return new Date(m.actual_end || m.actual_start || m.scheduled_start || m.created_at || Date.now())
}

function maintenanceBucket(m, now = new Date()) {
  const date = maintenanceDate(m)
  const days = Math.abs(differenceInCalendarDays(now, date))
  if (days === 0) return 'today'
  if (days <= 7) return 'last_week'
  if (days <= 30) return 'last_month'
  if (days <= 365) return 'last_year'
  return String(date.getFullYear())
}

function maintenanceBadgeClass(status) {
  if (status === 'completed') return 'bg-green-100 text-green-800'
  if (status === 'in_progress') return 'bg-orange-100 text-orange-800'
  if (status === 'scheduled') return 'bg-blue-100 text-blue-800'
  return 'bg-gray-100 text-gray-700'
}

function MaintenanceHistorySection({ items }) {
  const [openYears, setOpenYears] = useState([])

  const grouped = items.reduce((acc, item) => {
    const bucket = maintenanceBucket(item)
    if (bucket === 'today' || bucket === 'last_week' || bucket === 'last_month' || bucket === 'last_year') {
      acc[bucket].push(item)
    } else {
      if (!acc.years[bucket]) acc.years[bucket] = []
      acc.years[bucket].push(item)
    }
    return acc
  }, { today: [], last_week: [], last_month: [], last_year: [], years: {} })

  const yearKeys = Object.keys(grouped.years).sort((a, b) => Number(b) - Number(a))

  useEffect(() => {
    if (yearKeys.length > 0 && openYears.length === 0) {
      setOpenYears([yearKeys[0]])
    }
  }, [items])

  if (!items || items.length === 0) return null

  const groupOrder = [
    ['today', 'Today'],
    ['last_week', 'Last week'],
    ['last_month', 'Last month'],
    ['last_year', 'Last year'],
  ]

  return (
    <div className="space-y-4">
      {groupOrder.map(([key, label]) => grouped[key].length > 0 && (
        <LatestListSection
          key={key}
          items={grouped[key]}
          title={label}
          icon={<Clock size={16} />}
          headerClass="text-gray-700"
          renderItem={(m) => {
            const statusClass = maintenanceBadgeClass(m.status)
            return (
              <MaintenanceCard key={m.id} m={m} colorClass={statusClass} />
            )
          }}
        />
      ))}

      {yearKeys.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-gray-700 font-semibold flex items-center justify-between gap-3">
            <span className="flex items-center gap-2"><Clock size={16} />Previous years</span>
            <span className="text-xs font-normal text-gray-400">{yearKeys.length} years</span>
          </div>
          <div className="px-4 sm:px-5 py-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {yearKeys.map((year) => (
                <button
                  key={year}
                  type="button"
                  onClick={() => setOpenYears((current) => current.includes(year) ? current.filter(y => y !== year) : [...current, year])}
                  className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${openYears.includes(year) ? 'bg-brand-600 text-white border-brand-600' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
                >
                  {year} ({grouped.years[year].length})
                </button>
              ))}
            </div>
            <div className="space-y-4">
              {openYears.map((year) => (
                <LatestListSection
                  key={year}
                  items={grouped.years[year]}
                  title={year}
                  icon={<Clock size={16} />}
                  headerClass="text-gray-700"
                  renderItem={(m) => <MaintenanceCard key={m.id} m={m} colorClass={maintenanceBadgeClass(m.status)} />}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const SEV_BADGE = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-blue-100 text-blue-800',
}

function IncidentCard({ incident }) {
  const [expanded, setExpanded] = useState(false)
  const updates = incident.updates || []
  return (
    <div className="px-4 sm:px-5 py-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="font-medium text-sm">{incident.title}</p>
        <span className={`text-xs badge shrink-0 ${SEV_BADGE[incident.severity] || 'bg-gray-100 text-gray-700'}`}>
          {incident.severity}
        </span>
      </div>
      <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3">
        <span>Started: {fmt(incident.started_at, 'MM/dd HH:mm')}</span>
        {incident.status && (
          <span className="capitalize">{incident.status.replace(/_/g, ' ')}</span>
        )}
      </div>
      {incident.description && <p className="text-xs text-gray-400 mt-1">{incident.description}</p>}

      {updates.length > 0 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mt-2 transition-colors"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          Updates ({updates.length})
        </button>
      )}

      {expanded && (
        <div className="mt-3 space-y-3 border-l-2 border-red-200 dark:border-red-800 pl-3">
          {updates.map(u => (
            <div key={u.id}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-0.5">
                <span className="text-xs font-medium capitalize text-gray-700 dark:text-gray-200">
                  {u.status?.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-gray-400">
                  {fmt(u.created_at, 'MM/dd HH:mm')}
                  {u.author ? ` · ${u.author}` : ''}
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300">{u.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const CRITICALITY_BADGE = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  high:     'bg-orange-100 text-orange-800 border-orange-200',
  medium:   'bg-amber-100 text-amber-800 border-amber-200',
  low:      'bg-blue-100 text-blue-800 border-blue-200',
}

export default function StatusPage() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [expandedService, setExpandedService] = useState(null)
  const isLoggedIn = !!user || !!localStorage.getItem('token')

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
  const maintenanceHistory = data.maintenance_history || []
  const incidentHistory = data.incident_history || []
  const blackoutHistory = data.blackout_history || []
  const blackouts = data.blackout_periods || []
  const now = new Date()
  const activeBlackouts = blackouts.filter(b => {
    const start = new Date(b.start_date)
    const end = new Date(b.end_date)
    end.setHours(23, 59, 59, 999)
    return start <= now && end >= now
  })
  const upcomingBlackouts = blackouts.filter(b => new Date(b.start_date) > now)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 sm:py-12 px-4">
      <div className="max-w-3xl mx-auto space-y-6 sm:space-y-8">
        {/* Header */}
        <div className="relative text-center">
          <div className="absolute top-0 right-0">
            {isLoggedIn ? (
              <Link
                to="/"
                className="inline-flex items-center rounded-md border border-gray-300 dark:border-gray-600 px-2.5 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Back to app
              </Link>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center rounded-md border border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/30 px-2.5 py-1 text-xs text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800/40"
              >
                Login
              </Link>
            )}
          </div>
          {String(data.app_brand_image_url || '').trim() ? (
            <img
              src={String(data.app_brand_image_url || '').trim()}
              alt={data.app_name || 'GB Maintenance'}
              className="mx-auto w-14 h-14 sm:w-16 sm:h-16 object-contain mb-3 rounded-lg"
            />
          ) : (
            <img
              src="/logo.svg"
              alt={data.app_name || 'GB Maintenance'}
              className="mx-auto w-14 h-14 sm:w-16 sm:h-16 object-contain mb-3 rounded-lg"
            />
          )}
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{data.app_name}</h1>
          <p className="text-sm text-gray-500">Last updated: {fmt(data.last_updated)}</p>
          <p className="text-xs text-gray-400 mt-1">Live service health, incidents, and maintenance updates.</p>
        </div>

        {/* Active blackout — full red alert above everything */}
        {activeBlackouts.map(b => (
          <div key={b.id} className="rounded-xl bg-red-600 text-white p-4 sm:p-5 flex items-start gap-3 shadow-lg">
            <Ban size={22} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-base">Blackout period active: {b.name}</p>
              {b.description && <p className="text-sm text-red-100 mt-0.5">{b.description}</p>}
              <p className="text-sm text-red-200 mt-1">
                {fmt(b.start_date, 'MMM dd, yyyy')} → {fmt(b.end_date, 'MMM dd, yyyy')}
              </p>
              <p className="text-xs text-red-200 mt-1">No changes or maintenance windows are permitted during this period.</p>
            </div>
          </div>
        ))}

        {/* Upcoming blackout — amber warning */}
        {upcomingBlackouts.map(b => (
          <div key={b.id} className="rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 p-4 sm:p-5 flex items-start gap-3">
            <AlertTriangle size={20} className="flex-shrink-0 text-amber-600 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-800 dark:text-amber-300">Upcoming blackout: {b.name}</p>
              {b.description && <p className="text-sm text-amber-700 dark:text-amber-400 mt-0.5">{b.description}</p>}
              <p className="text-sm text-amber-600 dark:text-amber-500 mt-1">
                {fmt(b.start_date, 'MMM dd, yyyy')} → {fmt(b.end_date, 'MMM dd, yyyy')}
              </p>
            </div>
          </div>
        ))}

        {/* Overall status */}
        <div className="card p-5 sm:p-6 flex items-center gap-4">
          {OVERALL_ICONS[data.overall_status] || OVERALL_ICONS.operational}
          <span className="text-lg sm:text-xl font-semibold">{OVERALL_LABELS[data.overall_status] || data.overall_status}</span>
        </div>

        {/* Services */}
        <div className="card overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-gray-700 font-semibold">Services</div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {data.services.map(s => (
              <div key={s.id}>
                <div
                  className="flex items-center justify-between px-4 sm:px-5 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 select-none"
                  onClick={() => setExpandedService(expandedService === s.id ? null : s.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOT[s.status] || STATUS_DOT.unknown}`} />
                    <span className="font-medium text-sm">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 capitalize">{s.status?.replace(/_/g, ' ')}</span>
                  </div>
                </div>
                {expandedService === s.id && (
                  <div className="px-4 sm:px-5 pb-4 pt-1 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 space-y-1">
                    {s.description && <p>{s.description}</p>}
                    {s.criticality && (
                      <p className="flex items-center gap-2">
                        Criticality:
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${CRITICALITY_BADGE[s.criticality] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                          {s.criticality}
                        </span>
                      </p>
                    )}
                    {s.sla_uptime_percent != null && <p>SLA: <span className="font-medium">{s.sla_uptime_percent}%</span></p>}
                    {s.system_name && <p>Group: <span className="font-medium">{s.system_name}</span></p>}
                    {s.incident_count > 0 && <p className="text-red-600 font-medium">Active incidents: {s.incident_count}</p>}
                  </div>
                )}
              </div>
            ))}
            {data.services.length === 0 && <p className="text-center text-gray-500 py-6 text-sm">No public services are currently published.</p>}
          </div>
        </div>

        {/* Active Incidents */}
        {data.active_incidents?.length > 0 && (
          <div className="card overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-gray-700 font-semibold flex items-center gap-2 text-red-600">
              <XCircle size={16} />
              Active Incidents
              <span className="ml-auto text-xs font-normal text-gray-400">{data.active_incidents.length}</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.active_incidents.map(i => (
                <IncidentCard key={i.id} incident={i} />
              ))}
            </div>
          </div>
        )}

        {blackoutHistory.length > 0 && (
          <LatestListSection
            items={blackoutHistory}
            title="Blackout history"
            icon={<Ban size={16} />}
            headerClass="text-red-600"
            renderItem={(b) => (
              <div key={b.id} className="px-4 sm:px-5 py-4">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <p className="font-medium text-sm">{b.name}</p>
                  <span className="text-xs badge bg-red-100 text-red-800 shrink-0">blackout</span>
                </div>
                <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  <span>{fmt(b.start_date, 'MM/dd/yyyy')}</span>
                  <span>to</span>
                  <span>{fmt(b.end_date, 'MM/dd/yyyy')}</span>
                </div>
                {b.description && <p className="text-xs text-gray-500 mt-1">{b.description}</p>}
              </div>
            )}
          />
        )}

        <MaintenanceList
          items={inProgress}
          colorClass="bg-orange-100 text-orange-800"
          title="Maintenance in Progress"
          headerClass="text-orange-600"
          icon={<Wrench size={16} />}
        />

        <MaintenanceList
          items={upcoming}
          colorClass="bg-blue-100 text-blue-800"
          title="Scheduled Maintenance Windows"
          headerClass="text-blue-600"
          icon={<Clock size={16} />}
        />

        <MaintenanceHistorySection items={maintenanceHistory} />

        {incidentHistory.length > 0 && (
          <LatestListSection
            items={incidentHistory}
            title="Incident history"
            icon={<Bell size={16} />}
            headerClass="text-red-600"
            renderItem={(incident) => <IncidentCard key={incident.id} incident={incident} />}
          />
        )}
      </div>
    </div>
  )
}
