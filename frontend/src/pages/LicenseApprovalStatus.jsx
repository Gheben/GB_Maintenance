import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  ShieldCheck,
} from 'lucide-react'
import { licensesApi, settingsApi } from '../api'

const DEFAULT_BRANDING = {
  app_name: 'GB Maintenance',
  approval_page_logo_url: '',
  approval_page_primary_color: '#2563eb',
  approval_page_footer_text: 'Powered by {app_name}',
  approval_page_back_to_login_label: 'Back to login',
  approval_page_loading_label: 'Loading request status...',
  approval_page_missing_token_text: 'Missing status token',
  approval_page_load_error_text: 'Cannot load request status',
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

export default function LicenseApprovalStatus() {
  const [searchParams] = useSearchParams()
  const token = useMemo(() => (searchParams.get('token') || '').trim(), [searchParams])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState(null)
  const [branding, setBranding] = useState(() => ({ ...DEFAULT_BRANDING, ...(getCachedBranding() || {}) }))

  useEffect(() => {
    settingsApi.publicBranding()
      .then(r => {
        const payload = r.data || {}
        setBranding(prev => ({ ...prev, ...payload }))
        try {
          localStorage.setItem('public_branding_cache', JSON.stringify(payload))
        } catch {
          // Ignore quota/storage errors.
        }
      })
      .catch(() => setBranding(DEFAULT_BRANDING))
  }, [])

  useEffect(() => {
    const load = async () => {
      if (!token) {
        setError(branding.approval_page_missing_token_text || DEFAULT_BRANDING.approval_page_missing_token_text)
        return
      }
      setLoading(true)
      setError('')
      try {
        const r = await licensesApi.approvalStatusInfo(token)
        setInfo(r.data || null)
      } catch (err) {
        setError(err.response?.data?.error || branding.approval_page_load_error_text || DEFAULT_BRANDING.approval_page_load_error_text)
      } finally {
        setLoading(false)
      }
    }

    load().catch(() => {})
  }, [token, branding.approval_page_load_error_text, branding.approval_page_missing_token_text])

  const accent = branding.approval_page_primary_color || DEFAULT_BRANDING.approval_page_primary_color
  const appName = branding.app_name || DEFAULT_BRANDING.app_name
  const logoUrl = String(branding.approval_page_logo_url || '').trim()
  const title = 'License Approval Status'
  const subtitle = 'Track the request status and approver coverage.'
  const approvedDate = info?.approved_at ? new Date(info.approved_at) : null
  const rejectedDate = info?.rejected_at ? new Date(info.rejected_at) : null
  const hasApprovedDate = approvedDate && !Number.isNaN(approvedDate.getTime())
  const hasRejectedDate = rejectedDate && !Number.isNaN(rejectedDate.getTime())

  let latestDecisionStatus = ''
  let latestDecisionDate = null
  if (hasApprovedDate && hasRejectedDate) {
    if (approvedDate.getTime() >= rejectedDate.getTime()) {
      latestDecisionStatus = 'approved'
      latestDecisionDate = approvedDate
    } else {
      latestDecisionStatus = 'rejected'
      latestDecisionDate = rejectedDate
    }
  } else if (hasApprovedDate) {
    latestDecisionStatus = 'approved'
    latestDecisionDate = approvedDate
  } else if (hasRejectedDate) {
    latestDecisionStatus = 'rejected'
    latestDecisionDate = rejectedDate
  }

  const status = latestDecisionStatus || String(info?.approval_status || '').toLowerCase()
  const statusLabel = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending'
  const statusCls = status === 'approved'
    ? 'text-green-700 bg-green-50 border-green-200'
    : status === 'rejected'
      ? 'text-red-700 bg-red-50 border-red-200'
      : 'text-amber-700 bg-amber-50 border-amber-200'
  const footerTextTemplate = branding.approval_page_footer_text || DEFAULT_BRANDING.approval_page_footer_text
  const footerText = String(footerTextTemplate).replaceAll('{app_name}', appName)
  const approverEntries = Array.isArray(info?.approvers_notified)
    ? info.approvers_notified
    : []
  const fallbackApproverEmails = Array.isArray(info?.approver_emails) ? info.approver_emails : []
  const initials = appName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'GB'

  return (
    <div
      className="min-h-screen p-4 sm:p-8"
      style={{
        background: `radial-gradient(circle at top left, ${accent}22, transparent 35%), linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)`,
      }}
    >
      <div className="max-w-5xl mx-auto">
        <section className="rounded-[28px] border border-white/70 bg-white/85 backdrop-blur shadow-xl overflow-hidden">
          <div className="p-6 sm:p-8 border-b border-gray-100" style={{ background: `linear-gradient(135deg, ${accent}18, transparent 70%)` }}>
            <div className="flex items-start gap-4">
              {logoUrl ? (
                <img src={logoUrl} alt={appName} className="w-14 h-14 rounded-2xl object-contain bg-gray-100 shadow-sm border border-gray-100 p-2" />
              ) : (
                <div className="w-14 h-14 rounded-2xl text-white font-bold flex items-center justify-center shadow-sm" style={{ backgroundColor: accent }}>
                  {initials}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.22em] text-gray-500 font-semibold">{appName}</div>
                <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-gray-900 leading-tight">{title}</h1>
                <p className="mt-3 text-sm sm:text-base text-gray-600 max-w-2xl">{subtitle}</p>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-8 space-y-5">
            {loading && <p className="text-sm text-gray-500">{branding.approval_page_loading_label || DEFAULT_BRANDING.approval_page_loading_label}</p>}
            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3"><CircleAlert size={18} className="mt-0.5 shrink-0" />{error}</div>}

            {info && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">License</div>
                    <div className="mt-1 text-sm font-medium text-gray-900">{info.name || '—'}</div>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Supplier</div>
                    <div className="mt-1 text-sm font-medium text-gray-900">{info.supplier_company || '—'}</div>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Current Status</div>
                    <div className={`mt-1 inline-flex items-center gap-2 text-xs px-2 py-0.5 rounded-full border ${statusCls}`}>
                      {status === 'approved' ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                      {statusLabel}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Requested At</div>
                    <div className="mt-1 text-sm font-medium text-gray-900">{info.approval_requested_at ? new Date(info.approval_requested_at).toLocaleString() : '—'}</div>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Last Decision</div>
                    <div className="mt-1 text-sm font-medium text-gray-900">
                      {latestDecisionStatus ? `${latestDecisionStatus === 'approved' ? 'Approved' : 'Rejected'} - ${latestDecisionDate ? latestDecisionDate.toLocaleString() : '—'}` : 'Pending'}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Approvers notified</div>
                  <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 space-y-1">
                    {approverEntries.map((entry, idx) => (
                      <li key={`${entry?.email || entry?.name || 'approver'}-${idx}`}>
                        {entry?.label || `${entry?.name || ''}${entry?.email ? ` <${entry.email}>` : ''}`.trim() || 'Not available'}
                      </li>
                    ))}
                    {approverEntries.length === 0 && fallbackApproverEmails.map(email => (
                      <li key={email}>{email}</li>
                    ))}
                    {approverEntries.length === 0 && fallbackApproverEmails.length === 0 && <li>Not available</li>}
                  </ul>
                </div>

                {info.rejection_reason && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-red-700 font-semibold">Rejection reason</div>
                    <p className="mt-2 text-sm text-red-900">{info.rejection_reason}</p>
                  </div>
                )}
              </>
            )}

            <div className="pt-2 text-sm">
              <Link to="/login" className="inline-flex items-center gap-2 hover:underline" style={{ color: accent }}>
                <ShieldCheck size={16} />{branding.approval_page_back_to_login_label || DEFAULT_BRANDING.approval_page_back_to_login_label}
              </Link>
            </div>
          </div>
        </section>
      </div>
      <div className="max-w-5xl mx-auto pt-4 text-center text-[10px] text-gray-400">
        {footerText}
      </div>
    </div>
  )
}
