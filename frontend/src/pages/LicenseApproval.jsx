import { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  BadgeCheck,
  CheckCircle2,
  CircleAlert,
  CircleDot,
  Image as ImageIcon,
  LayoutList,
  Palette,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  XCircle,
} from 'lucide-react'
import { licensesApi, settingsApi } from '../api'

const SIDE_ICON_COMPONENTS = {
  'check-circle': CheckCircle2,
  'badge-check': BadgeCheck,
  'shield-check': ShieldCheck,
  'layout-list': LayoutList,
  image: ImageIcon,
  palette: Palette,
  sparkles: Sparkles,
  star: Star,
  'circle-dot': CircleDot,
}

const DEFAULT_BRANDING = {
  app_name: 'GB Maintenance',
  approval_page_title: 'License Approval',
  approval_page_subtitle: 'Review the request and confirm whether the license can be approved.',
  approval_page_logo_url: '',
  approval_page_primary_color: '#2563eb',
  approval_page_side_kicker: 'Approval Flow',
  approval_page_side_title: 'Simple, but brandable',
  approval_page_side_description: "This page can now be branded from Licenses > Template with company name, custom title, subtitle, logo, and primary color, so the approval request feels like part of the customer's own portal.",
  approval_page_side_rows_count: 4,
  approval_page_side_point_1: 'Company/app name shown in the public header',
  approval_page_side_point_2: 'Custom title and subtitle for approval requests',
  approval_page_side_point_3: 'Company logo uploaded from Licenses > Template',
  approval_page_side_point_4: 'Primary accent color used for CTA and highlights',
  approval_page_side_point_5: '',
  approval_page_side_point_6: '',
  approval_page_side_point_7: '',
  approval_page_side_point_8: '',
  approval_page_side_icon_1: 'shield-check',
  approval_page_side_icon_2: 'layout-list',
  approval_page_side_icon_3: 'image',
  approval_page_side_icon_4: 'palette',
  approval_page_side_icon_5: 'sparkles',
  approval_page_side_icon_6: 'star',
  approval_page_side_icon_7: 'check-circle',
  approval_page_side_icon_8: 'circle-dot',
  approval_page_back_to_login_label: 'Back to login',
  approval_page_footer_text: 'Powered by {app_name}',
  approval_page_load_button_label: 'Load request',
  approval_page_loading_label: 'Loading approval request...',
  approval_page_approve_button_label: 'Approve',
  approval_page_reject_button_label: 'Reject',
  approval_page_refresh_button_label: 'Refresh',
  approval_page_reject_reason_label: 'Reject reason (optional)',
  approval_page_reject_reason_placeholder: 'Add a note for the requester, if needed.',
  approval_page_missing_token_text: 'Missing approval token',
  approval_page_load_error_text: 'Cannot load approval request',
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

function normalizeApprovalDocuments(value) {
  const parsed = Array.isArray(value)
    ? value
    : (() => {
        if (!value) return []
        if (typeof value === 'string') {
          try {
            const obj = JSON.parse(value)
            return Array.isArray(obj) ? obj : []
          } catch {
            return []
          }
        }
        return []
      })()

  return parsed
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      name: String(item.name || '').trim(),
      url: String(item.url || '').trim(),
    }))
    .filter(item => item.name || item.url)
}

function normalizeApprovalDocumentUrl(rawUrl, appUrl = '') {
  const trimmed = String(rawUrl || '').trim()
  if (!trimmed) return ''

  const malformedMatch = trimmed.match(/^https?:\/\/\/+(.+)$/i)
  const collapsed = malformedMatch ? `/${String(malformedMatch[1] || '').replace(/^\/+/, '')}` : trimmed

  if (/^https?:\/\//i.test(collapsed)) return collapsed
  if (/^\//.test(collapsed) && appUrl) return `${String(appUrl).replace(/\/$/, '')}${collapsed}`
  return collapsed
}

export default function LicenseApproval() {
  const [searchParams] = useSearchParams()
  const token = useMemo(() => (searchParams.get('token') || '').trim(), [searchParams])
  const requestedIdFromQuery = useMemo(() => (searchParams.get('request') || '').trim(), [searchParams])

  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState(null)
  const [requests, setRequests] = useState([])
  const [selectedRequestId, setSelectedRequestId] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [reason, setReason] = useState('')
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

  const loadInfoById = async (requestId) => {
    if (!requestId) {
      setInfo(null)
      return
    }
    const r = await licensesApi.approvalInfoForRequest(token, requestId)
    setInfo(r.data)
  }

  const load = async () => {
    if (!token) {
      setError(branding.approval_page_missing_token_text || DEFAULT_BRANDING.approval_page_missing_token_text)
      return
    }
    setLoading(true)
    setError('')
    setResult('')
    try {
      const requestsRes = await licensesApi.approvalRequests(token)
      const list = Array.isArray(requestsRes.data?.requests) ? requestsRes.data.requests : []
      setRequests(list)

      if (!list.length) {
        setSelectedRequestId('')
        setInfo(null)
        return
      }

      const fallbackId = String(requestsRes.data?.current_request_id || '')
      const preferredId = selectedRequestId || requestedIdFromQuery || fallbackId || String(list[0].id)
      const exists = list.some(item => String(item.id) === String(preferredId))
      const targetId = exists ? String(preferredId) : String(list[0].id)

      setSelectedRequestId(targetId)
      await loadInfoById(targetId)
    } catch (err) {
      const status = Number(err?.response?.status || 0)
      const errMsg = String(err?.response?.data?.error || '')
      const alreadyProcessed = info && String(info.approval_status || '').toLowerCase() !== 'pending'
      if (status === 404 && /approval link not found/i.test(errMsg) && alreadyProcessed) {
        setError('')
        setResult(prev => prev || 'Request already processed')
        setLoading(false)
        return
      }

      try {
        // Backward compatibility for legacy single-request tokens.
        const fallback = await licensesApi.approvalInfo(token)
        setRequests(fallback.data?.id ? [fallback.data] : [])
        setSelectedRequestId(String(fallback.data?.id || ''))
        setInfo(fallback.data)
        setLoading(false)
        return
      } catch {
        // Ignore fallback errors and show canonical error below.
      }
      setRequests([])
      setSelectedRequestId('')
      setInfo(null)
      setError(err.response?.data?.error || branding.approval_page_load_error_text || DEFAULT_BRANDING.approval_page_load_error_text)
    } finally {
      setLoading(false)
    }
  }

  const approve = async () => {
    if (!selectedRequestId) return
    setBusy(true)
    setError('')
    try {
      const r = await licensesApi.approvalApproveRequest(token, selectedRequestId)
      setResult(r.data?.message || 'License approved')
      setInfo(prev => prev ? { ...prev, approval_status: 'approved' } : prev)
    } catch (err) {
      setError(err.response?.data?.error || 'Approval failed')
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    if (!selectedRequestId) return
    setBusy(true)
    setError('')
    try {
      const r = await licensesApi.approvalRejectRequest(token, selectedRequestId, reason)
      setResult(r.data?.message || 'License rejected')
      setInfo(prev => prev ? { ...prev, approval_status: 'rejected' } : prev)
    } catch (err) {
      setError(err.response?.data?.error || 'Reject failed')
    } finally {
      setBusy(false)
    }
  }

  const accent = branding.approval_page_primary_color || DEFAULT_BRANDING.approval_page_primary_color
  const logoUrl = String(branding.approval_page_logo_url || '').trim()
  const title = branding.approval_page_title || DEFAULT_BRANDING.approval_page_title
  const subtitle = branding.approval_page_subtitle || DEFAULT_BRANDING.approval_page_subtitle
  const appName = branding.app_name || DEFAULT_BRANDING.app_name
  const rowsRaw = Number(branding.approval_page_side_rows_count || DEFAULT_BRANDING.approval_page_side_rows_count || 4)
  const rowsCount = Number.isFinite(rowsRaw) ? Math.min(8, Math.max(1, Math.trunc(rowsRaw))) : 4
  const sideItems = Array.from({ length: rowsCount }, (_, i) => {
    const idx = i + 1
    const text = branding[`approval_page_side_point_${idx}`] || DEFAULT_BRANDING[`approval_page_side_point_${idx}`] || ''
    const iconName = String(branding[`approval_page_side_icon_${idx}`] || DEFAULT_BRANDING[`approval_page_side_icon_${idx}`] || 'check-circle')
    const Icon = SIDE_ICON_COMPONENTS[iconName] || CheckCircle2
    return { idx, text, Icon }
  }).filter(item => String(item.text || '').trim().length > 0)
  const footerTextTemplate = branding.approval_page_footer_text || DEFAULT_BRANDING.approval_page_footer_text
  const footerText = String(footerTextTemplate).replaceAll('{app_name}', appName)
  const docs = normalizeApprovalDocuments(info?.documents)
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
      <div className="max-w-5xl mx-auto grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
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
            {!info && !loading && (
              <button className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-white font-medium shadow-sm transition-transform hover:-translate-y-0.5" style={{ backgroundColor: accent }} onClick={load}>
                <ShieldCheck size={18} />{branding.approval_page_load_button_label || DEFAULT_BRANDING.approval_page_load_button_label}
              </button>
            )}

            {loading && <p className="text-sm text-gray-500">{branding.approval_page_loading_label || DEFAULT_BRANDING.approval_page_loading_label}</p>}

            {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3"><CircleAlert size={18} className="mt-0.5 shrink-0" />{error}</div>}
            {result && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-2xl p-4 flex items-start gap-3"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />{result}</div>}

            {info && (
              <div className="space-y-5">
                {requests.length > 1 && (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4">
                    <label className="block text-sm font-semibold mb-2 text-gray-800">Select request</label>
                    <select
                      className="input"
                      value={selectedRequestId}
                      onChange={async (e) => {
                        const id = e.target.value
                        setSelectedRequestId(id)
                        setResult('')
                        setError('')
                        setLoading(true)
                        try {
                          await loadInfoById(id)
                        } catch (err) {
                          setInfo(null)
                          setError(err.response?.data?.error || 'Cannot load selected request')
                        } finally {
                          setLoading(false)
                        }
                      }}
                    >
                      {requests.map(item => (
                        <option key={item.id} value={item.id}>
                          {`${item.name || 'License'}${item.supplier_company ? ` - ${item.supplier_company}` : ''}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ['License', info.name || '—'],
                    ['Supplier', info.supplier_company || '—'],
                    ['Expiry', info.expiry_date ? String(info.expiry_date).slice(0, 10) : '—'],
                    ['Status', info.approval_status || '—'],
                    ['Link expires', info.expires_at ? new Date(info.expires_at).toLocaleString() : '—'],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3">
                      <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">{label}</div>
                      <div className="mt-1 text-sm sm:text-base text-gray-900 font-medium break-words">{value}</div>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <label className="block text-sm font-semibold mb-2 text-gray-800">{branding.approval_page_reject_reason_label || DEFAULT_BRANDING.approval_page_reject_reason_label}</label>
                  <textarea className="input min-h-[120px]" rows={4} value={reason} onChange={e => setReason(e.target.value)} placeholder={branding.approval_page_reject_reason_placeholder || DEFAULT_BRANDING.approval_page_reject_reason_placeholder} />
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">Documents</div>
                  {docs.length > 0 ? (
                    <ul className="mt-2 list-disc pl-5 text-sm text-gray-800 space-y-1">
                      {docs.map((doc, idx) => {
                        const href = normalizeApprovalDocumentUrl(doc.url, branding.app_url)
                        const label = doc.name || href || `Document ${idx + 1}`
                        return (
                          <li key={`${label}-${idx}`}>
                            {href ? (
                              <a href={href} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline break-all">{label}</a>
                            ) : (
                              <span>{label}</span>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-gray-500">No documents attached</p>
                  )}
                </div>

                <div className="flex flex-wrap gap-3">
                  <button className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-white font-medium shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60" style={{ backgroundColor: accent }} disabled={busy || String(info.approval_status || '').toLowerCase() !== 'pending'} onClick={approve}><CheckCircle2 size={18} />{branding.approval_page_approve_button_label || DEFAULT_BRANDING.approval_page_approve_button_label}</button>
                  <button className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-gray-700 font-medium border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-60" disabled={busy || String(info.approval_status || '').toLowerCase() !== 'pending'} onClick={reject}><XCircle size={18} />{branding.approval_page_reject_button_label || DEFAULT_BRANDING.approval_page_reject_button_label}</button>
                  <button className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-gray-600 font-medium border border-gray-200 bg-gray-50 hover:bg-gray-100 disabled:opacity-60" disabled={busy || String(info.approval_status || '').toLowerCase() !== 'pending'} onClick={load}><RefreshCw size={18} />{branding.approval_page_refresh_button_label || DEFAULT_BRANDING.approval_page_refresh_button_label}</button>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="rounded-[28px] border border-white/70 bg-white/80 backdrop-blur shadow-xl p-6 sm:p-8 space-y-5">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-gray-500 font-semibold">{branding.approval_page_side_kicker || DEFAULT_BRANDING.approval_page_side_kicker}</div>
            <h2 className="mt-2 text-2xl font-bold text-gray-900">{branding.approval_page_side_title || DEFAULT_BRANDING.approval_page_side_title}</h2>
            <p className="mt-3 text-sm text-gray-600">{branding.approval_page_side_description || DEFAULT_BRANDING.approval_page_side_description}</p>
          </div>

          <div className="space-y-3">
            {sideItems.map(item => (
              <div key={item.idx} className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0 mt-0.5" style={{ backgroundColor: accent }}>
                  <item.Icon size={14} />
                </div>
                <p className="text-sm text-gray-700">{item.text}</p>
              </div>
            ))}
          </div>

          <div className="pt-2 text-sm">
            <Link to="/login" className="inline-flex items-center gap-2 hover:underline" style={{ color: accent }}>
              <ShieldCheck size={16} />{branding.approval_page_back_to_login_label || DEFAULT_BRANDING.approval_page_back_to_login_label}
            </Link>
          </div>
        </aside>
      </div>
      <div className="max-w-5xl mx-auto pt-4 text-center text-[10px] text-gray-400">
        {footerText}
      </div>
    </div>
  )
}
