import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { CheckCircle2, CircleAlert, RefreshCw, ShieldCheck, XCircle, CalendarClock } from 'lucide-react'
import { maintenanceApi, settingsApi } from '../api'

const DEFAULT_BRANDING = {
  app_name: 'GB Maintenance',
  approval_page_logo_url: '',
  approval_page_primary_color: '#2563eb',
  approval_page_footer_text: 'Powered by {app_name}',
  approval_page_back_to_login_label: 'Back to login',
  approval_page_loading_label: 'Loading approval request...',
  approval_page_missing_token_text: 'Missing approval token',
  approval_page_load_error_text: 'Cannot load approval request',
  maintenance_approval_page_title: 'Maintenance Approval',
  maintenance_approval_page_subtitle: 'Review the scheduled maintenance affecting an asset you own and confirm the proposed dates.',
  maintenance_approval_page_primary_color: '#2563eb',
  maintenance_approval_page_approve_label: 'Approve',
  maintenance_approval_page_reject_label: 'Reject',
  maintenance_approval_page_propose_label: 'Propose new date',
  maintenance_approval_page_submit_label: 'Submit proposed date',
  maintenance_approval_page_footer_text: 'Powered by {app_name}',
}

function getCachedBranding() {
  try {
    const raw = localStorage.getItem('public_branding_cache')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function formatDate(value, { includeTime = true } = {}) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('it-IT', includeTime
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function toDatetimeLocalValue(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const STATUS_LABELS = {
  pending: 'Awaiting your decision',
  reschedule_proposed: 'You proposed a new date — waiting for the creator',
  counter_proposed: 'The creator proposed another date — your decision needed',
  approved: 'You approved this maintenance schedule',
  rejected: 'You rejected this maintenance schedule',
  creator_accepted: 'Your proposed date was accepted',
  creator_rejected: 'Your proposed date was rejected',
}

export default function MaintenanceOwnerApproval() {
  const [searchParams] = useSearchParams()
  const token = useMemo(() => (searchParams.get('token') || '').trim(), [searchParams])

  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [note, setNote] = useState('')
  const [showReschedule, setShowReschedule] = useState(false)
  const [proposedStart, setProposedStart] = useState('')
  const [proposedEnd, setProposedEnd] = useState('')
  const [branding, setBranding] = useState(() => ({ ...DEFAULT_BRANDING, ...(getCachedBranding() || {}) }))

  useEffect(() => {
    settingsApi.publicBranding()
      .then(r => {
        const payload = r.data || {}
        setBranding(prev => ({ ...prev, ...payload }))
        try { localStorage.setItem('public_branding_cache', JSON.stringify(payload)) } catch { /* ignore storage errors */ }
      })
      .catch(() => setBranding(DEFAULT_BRANDING))
  }, [])

  const load = async () => {
    if (!token) {
      setError(branding.approval_page_missing_token_text || DEFAULT_BRANDING.approval_page_missing_token_text)
      return
    }
    setLoading(true)
    setError('')
    setResult('')
    try {
      const r = await maintenanceApi.publicOwnerApproval(token)
      setInfo(r.data)
      setProposedStart(toDatetimeLocalValue(r.data?.scheduled_start))
      setProposedEnd(toDatetimeLocalValue(r.data?.scheduled_end))
    } catch (err) {
      setInfo(null)
      setError(err.response?.data?.error || branding.approval_page_load_error_text || DEFAULT_BRANDING.approval_page_load_error_text)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (token) load() }, [token])

  const respond = async (action) => {
    setBusy(true)
    setError('')
    try {
      const payload = { token, action, note: note || undefined }
      if (action === 'reschedule') {
        if (!proposedStart || !proposedEnd) {
          setError('Please select both a proposed start and end date')
          setBusy(false)
          return
        }
        payload.proposed_start = new Date(proposedStart).toISOString()
        payload.proposed_end = new Date(proposedEnd).toISOString()
      }
      const r = await maintenanceApi.publicOwnerApprovalRespond(payload)
      setResult(r.data?.message || 'Response recorded')
      setShowReschedule(false)
      await load()
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const accent = branding.maintenance_approval_page_primary_color || DEFAULT_BRANDING.maintenance_approval_page_primary_color
  const appName = branding.maintenance_approval_page_app_name || branding.app_name || DEFAULT_BRANDING.app_name
  const logoUrl = String(branding.app_brand_image_url || branding.approval_page_logo_url || '').trim()
  const footerText = 'Powered by GB Maintenance'
  const initials = appName.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || 'GB'
  const status = String(info?.status || '').toLowerCase()
  const canAct = ['pending', 'counter_proposed'].includes(status)

  return (
    <div
      className="min-h-screen p-4 sm:p-8"
      style={{ background: `radial-gradient(circle at top left, ${accent}22, transparent 35%), linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)` }}
    >
      <div className="max-w-5xl mx-auto">
        <section className="rounded-[28px] border border-white/70 bg-white/85 backdrop-blur shadow-xl overflow-hidden">
          <div className="p-6 sm:p-8 border-b border-gray-100" style={{ background: `linear-gradient(135deg, ${accent}18, transparent 70%)` }}>
            <div className="flex items-start gap-4">
              {logoUrl ? (
                <img src={logoUrl} alt={appName} className="w-14 h-14 rounded-2xl object-contain bg-gray-100 shadow-sm border border-gray-100 p-2" />
              ) : (
                <div className="w-14 h-14 rounded-2xl text-white font-bold flex items-center justify-center shadow-sm" style={{ backgroundColor: accent }}>{initials}</div>
              )}
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.22em] text-gray-500 font-semibold">{appName}</div>
                <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-gray-900 leading-tight">{branding.maintenance_approval_page_title || DEFAULT_BRANDING.maintenance_approval_page_title}</h1>
                <p className="mt-3 text-sm sm:text-base text-gray-600 max-w-2xl">{branding.maintenance_approval_page_subtitle || DEFAULT_BRANDING.maintenance_approval_page_subtitle}</p>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8 space-y-5">
            {loading && <p className="text-sm text-gray-500">{branding.approval_page_loading_label || DEFAULT_BRANDING.approval_page_loading_label}</p>}
            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3"><CircleAlert size={18} className="mt-0.5 shrink-0" />{error}</div>}
            {result && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-2xl p-4 flex items-start gap-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{result}</div>}

            {info && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-gray-200 bg-indigo-50/60 px-4 py-3 text-sm font-medium text-indigo-800">
                  {STATUS_LABELS[status] || status || 'Status unknown'}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ['Maintenance', info.title || '—'],
                    ['Scope', `${info.owner_source_type || '—'}: ${info.owner_source_name || '—'}`],
                    ['Scheduled start', formatDate(info.scheduled_start)],
                    ['Scheduled end', formatDate(info.scheduled_end)],
                    ['Impact', info.impact_level || '—'],
                    ['Type', info.type || '—'],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3">
                      <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">{label}</div>
                      <div className="mt-1 text-sm sm:text-base text-gray-900 font-medium break-words">{value}</div>
                    </div>
                  ))}
                </div>

                {info.description && (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Description</div>
                    <p className="mt-1 text-sm text-gray-800 whitespace-pre-wrap">{info.description}</p>
                  </div>
                )}

                {status === 'counter_proposed' && (info.creator_proposed_start || info.creator_proposed_end) && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
                    <CalendarClock size={18} className="mt-0.5 shrink-0 text-amber-600" />
                    <div className="text-sm text-amber-800">
                      <p className="font-semibold">The creator proposed a different schedule:</p>
                      <p>{formatDate(info.creator_proposed_start)} → {formatDate(info.creator_proposed_end)}</p>
                    </div>
                  </div>
                )}

                {canAct && (
                  <>
                    <div className="rounded-2xl border border-gray-200 bg-white p-4">
                      <label className="block text-sm font-semibold mb-2 text-gray-800">Note (optional)</label>
                      <textarea className="input min-h-[100px]" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note for the maintenance planner, if needed." />
                    </div>

                    {showReschedule && (
                      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="block text-sm font-semibold mb-1 text-gray-800">Proposed start</label>
                            <input type="datetime-local" className="input" value={proposedStart} onChange={e => setProposedStart(e.target.value)} />
                          </div>
                          <div>
                            <label className="block text-sm font-semibold mb-1 text-gray-800">Proposed end</label>
                            <input type="datetime-local" className="input" value={proposedEnd} onChange={e => setProposedEnd(e.target.value)} />
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-3">
                      <button className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-white font-medium shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60" style={{ backgroundColor: accent }} disabled={busy} onClick={() => respond('approve')}>
                        <CheckCircle2 size={18} />{branding.maintenance_approval_page_approve_label || DEFAULT_BRANDING.maintenance_approval_page_approve_label}
                      </button>
                      <button className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-gray-700 font-medium border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-60" disabled={busy} onClick={() => respond('reject')}>
                        <XCircle size={18} />{branding.maintenance_approval_page_reject_label || DEFAULT_BRANDING.maintenance_approval_page_reject_label}
                      </button>
                      {!showReschedule ? (
                        <button className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-gray-600 font-medium border border-gray-200 bg-gray-50 hover:bg-gray-100 disabled:opacity-60" disabled={busy} onClick={() => setShowReschedule(true)}>
                          <CalendarClock size={18} />{branding.maintenance_approval_page_propose_label || DEFAULT_BRANDING.maintenance_approval_page_propose_label}
                        </button>
                      ) : (
                        <button className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-white font-medium shadow-sm disabled:opacity-60" style={{ backgroundColor: '#0f766e' }} disabled={busy} onClick={() => respond('reschedule')}>
                          <CalendarClock size={18} />{branding.maintenance_approval_page_submit_label || DEFAULT_BRANDING.maintenance_approval_page_submit_label}
                        </button>
                      )}
                      <button className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-gray-600 font-medium border border-gray-200 bg-gray-50 hover:bg-gray-100 disabled:opacity-60" disabled={busy} onClick={load}>
                        <RefreshCw size={18} />Refresh
                      </button>
                    </div>
                  </>
                )}

                <div className="pt-2 text-sm">
                  <Link to="/login" className="inline-flex items-center gap-2 hover:underline" style={{ color: accent }}>
                    <ShieldCheck size={16} />{branding.approval_page_back_to_login_label || DEFAULT_BRANDING.approval_page_back_to_login_label}
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
      <div className="max-w-5xl mx-auto pt-4 text-center text-[10px] text-gray-400">{footerText}</div>
    </div>
  )
}
