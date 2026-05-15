import { useEffect, useMemo, useState } from 'react'
import { Layout } from '../components/Layout'
import { licensesApi, suppliersApi, assetsApi, servicesApi, settingsApi, uploadsApi, usersApi } from '../api'
import { Pagination } from '../components/Pagination'
import { Modal, ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  CircleDot,
  Eye,
  Image as ImageIcon,
  LayoutList,
  Palette,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload,
  UserRound,
  XCircle,
  FileText,
  Phone,
  Mail,
  Clock,
} from 'lucide-react'
import { QuickCreateUserModal } from '../components/QuickCreateModals'

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

const SIDE_ICON_OPTIONS = [
  { value: 'check-circle', label: 'Check Circle' },
  { value: 'badge-check', label: 'Badge Check' },
  { value: 'shield-check', label: 'Shield Check' },
  { value: 'layout-list', label: 'List' },
  { value: 'image', label: 'Image' },
  { value: 'palette', label: 'Palette' },
  { value: 'sparkles', label: 'Sparkles' },
  { value: 'star', label: 'Star' },
  { value: 'circle-dot', label: 'Circle Dot' },
]

const emptyLicenseForm = {
  name: '',
  description: '',
  supplier_id: '',
  owner_contacts: [],
  maintainer_contacts: [],
  approver_contacts: [],
  activation_date: '',
  duration_months: '12',
  expiry_mode: 'duration',
  expiry_date: '',
  reminder_days: 30,
  approval_required: true,
  approval_status: 'pending',
  estimated_cost: '',
  currency: 'EUR',
  notes: '',
  documents: [],
  asset_ids: [],
  service_ids: [],
}

const emptySupplierForm = {
  first_name: '',
  last_name: '',
  company: '',
  nationality: '',
  phone: '',
  mobile: '',
  email: '',
  vat_number: '',
  notes: '',
  website: '',
  contract_reference: '',
  contract_start_date: '',
  contract_end_date: '',
  availability_hours: '',
  emergency_phone: '',
  emergency_email: '',
  sla_resolution_hours: '',
  contract_notes: '',
  contract_documents: [],
}

const templateDefaults = {
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

function formatContact(c) {
  if (!c || typeof c !== 'object') return '—'
  if (c.type === 'supplier') return `${c.company || 'Supplier'} (${c.email || 'no email'})`
  return c.name || c.username || c.email || '—'
}

function contactKey(c) {
  if (!c || typeof c !== 'object') return ''
  return `${c.type || 'x'}::${c.id || c.dn || c.email || c.username || c.name || ''}`
}

function dedupeContacts(list) {
  const out = []
  const seen = new Set()
  for (const c of (Array.isArray(list) ? list : [])) {
    if (!c || typeof c !== 'object') continue
    const key = contactKey(c)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

function approvalStatusMeta(status, approvalRequired = true) {
  if (!approvalRequired) return { label: 'Not required', cls: 'bg-slate-100 text-slate-700' }
  if (status === 'approved') return { label: 'Approved', cls: 'bg-green-100 text-green-700' }
  if (status === 'rejected') return { label: 'Rejected', cls: 'bg-red-100 text-red-700' }
  return { label: 'Pending', cls: 'bg-amber-100 text-amber-700' }
}

const FALLBACK_REGION_CODES = [
  'AD', 'AE', 'AL', 'AR', 'AT', 'AU', 'BA', 'BE', 'BG', 'BR', 'BY', 'CA', 'CH', 'CL', 'CN', 'CO', 'CR',
  'CY', 'CZ', 'DE', 'DK', 'DO', 'DZ', 'EE', 'EG', 'ES', 'FI', 'FR', 'GB', 'GE', 'GR', 'HR', 'HU', 'IE',
  'IL', 'IN', 'IQ', 'IR', 'IS', 'IT', 'JP', 'KR', 'KZ', 'LB', 'LI', 'LT', 'LU', 'LV', 'MA', 'MC', 'MD',
  'ME', 'MK', 'MT', 'MX', 'NL', 'NO', 'NZ', 'PE', 'PL', 'PT', 'RO', 'RS', 'RU', 'SA', 'SE', 'SI', 'SK',
  'SM', 'TN', 'TR', 'UA', 'US', 'UY', 'VA', 'VE', 'ZA'
]

function regionCodeToFlag(code) {
  if (!/^[A-Z]{2}$/.test(code || '')) return ''
  const base = 127397
  return String.fromCodePoint(...code.split('').map(ch => base + ch.charCodeAt(0)))
}

const COUNTRY_OPTIONS = (() => {
  const regionCodes = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('region')
    : FALLBACK_REGION_CODES

  const displayNames = new Intl.DisplayNames(['en'], { type: 'region' })
  return [...new Set(regionCodes)]
    .filter(code => /^[A-Z]{2}$/.test(code))
    .map((code) => {
      const name = displayNames.of(code) || code
      return {
        code,
        name,
        label: `${regionCodeToFlag(code)} ${name}`.trim(),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
})()

function NationalityPicker({ value, onChange }) {
  const customOption = useMemo(() => {
    const current = String(value || '').trim()
    if (!current) return null
    const found = COUNTRY_OPTIONS.some(option => option.name === current)
    if (found) return null
    return { name: current, label: `🏳️ ${current}` }
  }, [value])

  return (
    <select className="input" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select nationality</option>
      {customOption ? <option value={customOption.name}>{customOption.label}</option> : null}
      {COUNTRY_OPTIONS.map(option => (
        <option key={option.code} value={option.name}>{option.label}</option>
      ))}
    </select>
  )
}

function normalizeSupplierPayload(form) {
  return {
    ...form,
    nationality: form.nationality?.trim() || null,
    phone: form.phone?.trim() || null,
    mobile: form.mobile?.trim() || null,
    vat_number: form.vat_number?.trim() || null,
    notes: form.notes?.trim() || null,
    website: form.website?.trim() || null,
    contract_reference: form.contract_reference?.trim() || null,
    contract_start_date: form.contract_start_date || null,
    contract_end_date: form.contract_end_date || null,
    availability_hours: form.availability_hours?.trim() || null,
    emergency_phone: form.emergency_phone?.trim() || null,
    emergency_email: form.emergency_email?.trim() || null,
    sla_resolution_hours: form.sla_resolution_hours === '' ? null : Number(form.sla_resolution_hours),
    contract_notes: form.contract_notes?.trim() || null,
  }
}

function extractContactList(value) {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return dedupeContacts(value)
  const nested = Array.isArray(value.contacts) ? value.contacts : []
  return dedupeContacts([value, ...nested])
}

function contactSummary(value) {
  const list = extractContactList(value)
  if (list.length === 0) return '—'
  const first = formatContact(list[0])
  return list.length > 1 ? `${first} +${list.length - 1}` : first
}

function primaryContactPayload(list) {
  const contacts = dedupeContacts(list)
  if (contacts.length === 0) return null
  const first = contacts[0]
  return { ...first, contacts }
}

function mergeUniqueContacts(a, b) {
  const out = []
  const seen = new Set()
  for (const item of [...a, ...b]) {
    const key = `${item.type || 'x'}::${item.id || item.dn || item.email || item.name || Math.random()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function toLicensePayload(form) {
  const ownerContact = primaryContactPayload(form.owner_contacts)
  const maintainerContact = primaryContactPayload(form.maintainer_contacts)
  const approverContact = primaryContactPayload(form.approver_contacts)
  const customExpiryDate = form.expiry_mode === 'custom' ? (form.expiry_date || null) : null

  return {
    ...form,
    supplier_id: form.supplier_id || null,
    owner_contact: ownerContact,
    owner_user_id: null,
    maintainer_contact: maintainerContact,
    maintainer_user_id: null,
    approver_contact: approverContact,
    approver_user_id: null,
    activation_date: form.activation_date || null,
    duration_months: form.expiry_mode === 'duration' ? Number(form.duration_months || 12) : null,
    custom_expiry_date: customExpiryDate,
    expiry_date: customExpiryDate,
    estimated_cost: form.estimated_cost === '' ? null : Number(form.estimated_cost),
    reminder_days: Number(form.reminder_days || 30),
    documents: Array.isArray(form.documents) ? form.documents : [],
  }
}

function SupplierForm({ value, onChange }) {
  const set = (k, v) => onChange(f => ({ ...f, [k]: v }))
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">First name *</label>
          <input className="input" required value={value.first_name} onChange={e => set('first_name', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Last name *</label>
          <input className="input" required value={value.last_name} onChange={e => set('last_name', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Company *</label>
          <input className="input" required value={value.company} onChange={e => set('company', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Nationality</label>
          <NationalityPicker value={value.nationality} onChange={(next) => set('nationality', next)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Phone</label>
          <input className="input" value={value.phone} onChange={e => set('phone', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Mobile</label>
          <input className="input" value={value.mobile} onChange={e => set('mobile', e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">VAT number</label>
          <input className="input" value={value.vat_number} onChange={e => set('vat_number', e.target.value)} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Email *</label>
        <input className="input" type="email" required value={value.email} onChange={e => set('email', e.target.value)} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Notes</label>
        <textarea className="input min-h-[90px]" value={value.notes} onChange={e => set('notes', e.target.value)} />
      </div>
    </div>
  )
}

function SupplierFavicon({ url }) {
  const [sourceIndex, setSourceIndex] = useState(0)
  if (!url) return null
  let origin = url
  let host = ''
  try { origin = new URL(url.startsWith('http') ? url : `https://${url}`).origin } catch { return null }
  try { host = new URL(url.startsWith('http') ? url : `https://${url}`).hostname } catch { return null }

  const sources = [
    `${origin}/favicon.ico`,
    `${origin}/favicon.png`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`,
  ]

  if (sourceIndex >= sources.length) return null

  return (
    <img
      src={sources[sourceIndex]}
      alt=""
      width={16}
      height={16}
      className="inline-block w-4 h-4 object-contain rounded-sm"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setSourceIndex((i) => i + 1)}
    />
  )
}

function SupplierFormTabbed({ value, onChange, onUploadDoc }) {
  const [activeTab, setActiveTab] = useState('general')
  const set = (k, v) => onChange(f => ({ ...f, [k]: v }))

  return (
    <div>
      {/* Tab nav */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-4">
        {[['general', 'General', Building2], ['contract', 'Contract', FileText]].map(([k, l, Icon]) => (
          <button
            key={k}
            type="button"
            onClick={() => setActiveTab(k)}
            className={`px-3.5 py-1.5 text-sm font-medium inline-flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${
              activeTab === k
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            <Icon size={14} />{l}
          </button>
        ))}
      </div>

      {activeTab === 'general' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">First name *</label>
              <input className="input" required value={value.first_name} onChange={e => set('first_name', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Last name *</label>
              <input className="input" required value={value.last_name} onChange={e => set('last_name', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Company *</label>
              <input className="input" required value={value.company} onChange={e => set('company', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Nationality</label>
              <NationalityPicker value={value.nationality} onChange={(next) => set('nationality', next)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input className="input" value={value.phone} onChange={e => set('phone', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Mobile</label>
              <input className="input" value={value.mobile} onChange={e => set('mobile', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">VAT number</label>
              <input className="input" value={value.vat_number} onChange={e => set('vat_number', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Email *</label>
              <input className="input" type="email" required value={value.email} onChange={e => set('email', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Website</label>
              <input className="input" type="url" placeholder="https://example.com" value={value.website} onChange={e => set('website', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea className="input min-h-[90px]" value={value.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>
      )}

      {activeTab === 'contract' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Contract reference</label>
              <input className="input" placeholder="CTR-2024-001" value={value.contract_reference} onChange={e => set('contract_reference', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Start date</label>
              <input className="input" type="date" value={value.contract_start_date} onChange={e => set('contract_start_date', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">End date</label>
              <input className="input" type="date" value={value.contract_end_date} onChange={e => set('contract_end_date', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1 inline-flex items-center gap-1"><Clock size={13} />Availability hours</label>
              <input className="input" placeholder="Mon–Fri 9:00–18:00" value={value.availability_hours} onChange={e => set('availability_hours', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">SLA resolution (hours)</label>
              <input className="input" type="number" min="0" placeholder="e.g. 8" value={value.sla_resolution_hours} onChange={e => set('sla_resolution_hours', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1 inline-flex items-center gap-1"><Phone size={13} />Emergency phone</label>
              <input className="input" value={value.emergency_phone} onChange={e => set('emergency_phone', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 inline-flex items-center gap-1"><Mail size={13} />Emergency email</label>
              <input className="input" type="email" value={value.emergency_email} onChange={e => set('emergency_email', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Contract notes</label>
            <textarea className="input min-h-[80px]" value={value.contract_notes} onChange={e => set('contract_notes', e.target.value)} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Contract documents</label>
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer text-sm">
              <Upload size={14} />Upload document(s)
              <input type="file" className="hidden" multiple onChange={e => onUploadDoc && onUploadDoc(e.target.files)} />
            </label>
            <div className="mt-2 space-y-1">
              {(value.contract_documents || []).map((d, i) => (
                <div key={`${d.url || 'doc'}-${i}`} className="flex items-center justify-between gap-2 text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5">
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline truncate">{d.name || d.url}</a>
                  <button type="button" className="text-red-500 hover:underline shrink-0" onClick={() => onChange(f => ({ ...f, contract_documents: (f.contract_documents || []).filter((_, idx) => idx !== i) }))}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ContactPicker({ label, placeholder, value, onChange, onSearch, loading, results, createActions }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const selected = dedupeContacts(value)
  const selectedKeys = new Set(selected.map(contactKey))

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      const cleaned = q.trim()
      if (cleaned.length >= 1) onSearch(cleaned)
      else onSearch('')
    }, 250)
    return () => clearTimeout(t)
  }, [open, q, onSearch])

  const toggle = (item) => {
    const key = contactKey(item)
    if (!key) return
    const next = selectedKeys.has(key)
      ? selected.filter(c => contactKey(c) !== key)
      : [...selected, item]
    onChange(dedupeContacts(next))
  }

  const clearAll = () => {
    onChange([])
    setQ('')
    onSearch('')
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium mb-1">{label}</label>
        <button type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50" onClick={() => setOpen(true)}>
          Select
        </button>
      </div>

      <div className="text-xs text-gray-500 border border-gray-200 rounded-lg px-2.5 py-1.5">
        {selected.length > 0 ? `${selected.length} selected` : 'No contacts selected'}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((c, idx) => (
            <span key={`${contactKey(c)}-${idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-brand-100 text-brand-700">
              {formatContact(c)}
              <button type="button" className="hover:text-red-600" onClick={() => toggle(c)}>×</button>
            </span>
          ))}
          <button type="button" className="text-xs text-gray-500 hover:text-gray-700" onClick={clearAll}>Clear all</button>
        </div>
      )}

      {open && (
        <Modal title={label} onClose={() => { setOpen(false); setQ(''); onSearch('') }} size="lg">
          <div className="space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-8" placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)} />
            </div>

            {Array.isArray(createActions) && createActions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {createActions.map(action => (
                  <button key={action.label} type="button" className="btn-secondary" onClick={action.onClick}>{action.label}</button>
                ))}
              </div>
            )}

            <div className="max-h-[52vh] overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
              {!q.trim() && <div className="px-3 py-3 text-sm text-gray-500">Start typing to search.</div>}
              {!!q.trim() && (!Array.isArray(results) || results.length === 0) && <div className="px-3 py-3 text-sm text-gray-500">No results found.</div>}
              {(results || []).map((r, idx) => {
                const key = `${contactKey(r)}-${idx}`
                return (
                  <label key={key} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer text-sm">
                    <input type="checkbox" checked={selectedKeys.has(contactKey(r))} onChange={() => toggle(r)} className="rounded" />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{r.name || r.company || r.email || r.dn}</span>
                      <span className="block truncate text-xs text-gray-400">{[r.email, r.mobile || r.phone].filter(Boolean).join(' • ') || r.dn || ''}</span>
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{String(r.type || '').toUpperCase()}</span>
                  </label>
                )
              })}
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => { setOpen(false); setQ(''); onSearch('') }}>Done</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function TemplateVisualEditor({ templateConfig, setTemplateConfig, templateUploading, onUploadLogo, readOnly = false }) {
  const accent = templateConfig.approval_page_primary_color || '#2563eb'
  const appName = templateConfig.app_name || 'GB Maintenance'
  const logo = templateConfig.approval_page_logo_url || ''
  const initials = appName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase())
    .join('') || 'GB'
  const rowsRaw = Number(templateConfig.approval_page_side_rows_count || 4)
  const rowsCount = Number.isFinite(rowsRaw) ? Math.min(8, Math.max(1, Math.trunc(rowsRaw))) : 4
  const sideRows = Array.from({ length: rowsCount }, (_, i) => {
    const idx = i + 1
    const textKey = `approval_page_side_point_${idx}`
    const iconKey = `approval_page_side_icon_${idx}`
    const iconName = String(templateConfig[iconKey] || 'check-circle')
    const Icon = SIDE_ICON_COMPONENTS[iconName] || CheckCircle2
    return { idx, textKey, iconKey, iconName, Icon }
  })
  const footerPreview = String(templateConfig.approval_page_footer_text || 'Powered by {app_name}').replaceAll('{app_name}', appName)

  const setField = (key, value) => {
    if (readOnly) return
    setTemplateConfig(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div
      className="rounded-2xl p-3 sm:p-4"
      style={{
        background: `radial-gradient(circle at top left, ${accent}22, transparent 35%), linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)`,
      }}
    >
      <div className="grid gap-4 lg:grid-cols-[1.12fr_0.88fr]">
        <section className="rounded-2xl border border-white/70 bg-white/90 shadow-md overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-gray-100" style={{ background: `linear-gradient(135deg, ${accent}18, transparent 70%)` }}>
            <div className="flex gap-3 items-start">
              <div className="shrink-0">
                {logo ? (
                  <img src={logo} alt={appName} className="w-12 h-12 rounded-xl object-contain bg-white border border-gray-100 p-1.5" />
                ) : (
                  <div className="w-12 h-12 rounded-xl text-white font-bold flex items-center justify-center" style={{ backgroundColor: accent }}>
                    {initials}
                  </div>
                )}
                {!readOnly && (
                  <div className="mt-2 flex gap-1.5">
                    <label className="text-[11px] px-2 py-1 rounded border border-gray-200 cursor-pointer hover:bg-gray-50">
                      Upload
                      <input type="file" accept="image/*" className="hidden" disabled={templateUploading} onChange={e => onUploadLogo(e.target.files?.[0])} />
                    </label>
                    {!!logo && <button type="button" className="text-[11px] px-2 py-1 rounded border border-red-200 text-red-700" onClick={() => setField('approval_page_logo_url', '')}>Remove</button>}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                {readOnly ? (
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500 font-semibold">{appName}</div>
                ) : (
                  <input className="input h-8 text-xs uppercase tracking-[0.2em]" value={templateConfig.app_name || ''} onChange={e => setField('app_name', e.target.value)} placeholder="Application name" />
                )}
                {readOnly ? (
                  <h3 className="text-2xl font-bold text-gray-900">{templateConfig.approval_page_title || ''}</h3>
                ) : (
                  <input className="input h-10 text-lg font-semibold" value={templateConfig.approval_page_title || ''} onChange={e => setField('approval_page_title', e.target.value)} placeholder="Main title" />
                )}
                {readOnly ? (
                  <p className="text-sm text-gray-600">{templateConfig.approval_page_subtitle || ''}</p>
                ) : (
                  <textarea className="input min-h-[62px] text-sm" value={templateConfig.approval_page_subtitle || ''} onChange={e => setField('approval_page_subtitle', e.target.value)} placeholder="Subtitle" />
                )}
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="px-3 py-2 rounded-xl text-white text-sm" style={{ backgroundColor: accent }}>
                {templateConfig.approval_page_load_button_label || 'Load request'}
              </button>
              {!readOnly && <input className="input h-9 max-w-[240px]" value={templateConfig.approval_page_load_button_label || ''} onChange={e => setField('approval_page_load_button_label', e.target.value)} placeholder="Load button label" />}
            </div>

            {!readOnly && (
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="input h-9" value={templateConfig.approval_page_loading_label || ''} onChange={e => setField('approval_page_loading_label', e.target.value)} placeholder="Loading text" />
                <input className="input h-9" value={templateConfig.approval_page_load_error_text || ''} onChange={e => setField('approval_page_load_error_text', e.target.value)} placeholder="Load error text" />
              </div>
            )}

            <div className="rounded-2xl border border-gray-200 bg-white p-3">
              {readOnly ? (
                <div className="text-sm font-semibold mb-2">{templateConfig.approval_page_reject_reason_label || ''}</div>
              ) : (
                <input className="input h-9 mb-2" value={templateConfig.approval_page_reject_reason_label || ''} onChange={e => setField('approval_page_reject_reason_label', e.target.value)} placeholder="Reject reason label" />
              )}
              {readOnly ? (
                <div className="text-sm text-gray-500 border border-gray-200 rounded-lg px-3 py-2">{templateConfig.approval_page_reject_reason_placeholder || ''}</div>
              ) : (
                <input className="input h-9" value={templateConfig.approval_page_reject_reason_placeholder || ''} onChange={e => setField('approval_page_reject_reason_placeholder', e.target.value)} placeholder="Reject reason placeholder" />
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="px-3 py-2 rounded-xl text-white text-sm" style={{ backgroundColor: accent }}>{templateConfig.approval_page_approve_button_label || 'Approve'}</button>
              <button type="button" className="px-3 py-2 rounded-xl border border-gray-300 bg-white text-sm">{templateConfig.approval_page_reject_button_label || 'Reject'}</button>
              <button type="button" className="px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-sm">{templateConfig.approval_page_refresh_button_label || 'Refresh'}</button>
            </div>

            {!readOnly && (
              <div className="grid gap-3 sm:grid-cols-3">
                <input className="input h-9" value={templateConfig.approval_page_approve_button_label || ''} onChange={e => setField('approval_page_approve_button_label', e.target.value)} placeholder="Approve button" />
                <input className="input h-9" value={templateConfig.approval_page_reject_button_label || ''} onChange={e => setField('approval_page_reject_button_label', e.target.value)} placeholder="Reject button" />
                <input className="input h-9" value={templateConfig.approval_page_refresh_button_label || ''} onChange={e => setField('approval_page_refresh_button_label', e.target.value)} placeholder="Refresh button" />
              </div>
            )}

            {!readOnly && (
              <div className="grid gap-3 sm:grid-cols-2">
                <input className="input h-9" value={templateConfig.approval_page_missing_token_text || ''} onChange={e => setField('approval_page_missing_token_text', e.target.value)} placeholder="Missing token text" />
                <div className="flex items-center gap-2">
                  <input type="color" className="w-10 h-9 rounded border border-gray-300 p-1 bg-white" value={templateConfig.approval_page_primary_color || '#2563eb'} onChange={e => setField('approval_page_primary_color', e.target.value)} />
                  <input className="input h-9 font-mono" value={templateConfig.approval_page_primary_color || '#2563eb'} onChange={e => setField('approval_page_primary_color', e.target.value)} placeholder="#2563eb" />
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="rounded-2xl border border-white/70 bg-white/85 shadow-md p-4 sm:p-5 space-y-3">
          {readOnly ? (
            <div className="text-xs uppercase tracking-[0.2em] text-gray-500 font-semibold">{templateConfig.approval_page_side_kicker || ''}</div>
          ) : (
            <input className="input h-8 text-xs uppercase tracking-[0.2em]" value={templateConfig.approval_page_side_kicker || ''} onChange={e => setField('approval_page_side_kicker', e.target.value)} placeholder="Sidebar kicker" />
          )}

          {readOnly ? (
            <h4 className="text-xl font-bold text-gray-900">{templateConfig.approval_page_side_title || ''}</h4>
          ) : (
            <input className="input h-10 text-base font-semibold" value={templateConfig.approval_page_side_title || ''} onChange={e => setField('approval_page_side_title', e.target.value)} placeholder="Sidebar title" />
          )}

          {readOnly ? (
            <p className="text-sm text-gray-600">{templateConfig.approval_page_side_description || ''}</p>
          ) : (
            <textarea className="input min-h-[72px] text-sm" value={templateConfig.approval_page_side_description || ''} onChange={e => setField('approval_page_side_description', e.target.value)} placeholder="Sidebar description" />
          )}

          <div className="space-y-2">
            {!readOnly && (
              <div className="grid grid-cols-1 sm:grid-cols-[130px_1fr] gap-2">
                <label className="text-xs text-gray-500 uppercase tracking-wide self-center">Sidebar rows</label>
                <select className="input h-9" value={rowsCount} onChange={e => setField('approval_page_side_rows_count', Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}

            {sideRows.map((row) => (
              <div key={row.textKey} className="rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 text-sm">
                {readOnly ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-white" style={{ backgroundColor: accent }}>
                      <row.Icon size={14} />
                    </span>
                    <span>{templateConfig[row.textKey] || ''}</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px] gap-2">
                    <input className="input h-8" value={templateConfig[row.textKey] || ''} onChange={e => setField(row.textKey, e.target.value)} placeholder={`Sidebar bullet ${row.idx}`} />
                    <select className="input h-8" value={row.iconName} onChange={e => setField(row.iconKey, e.target.value)}>
                      {SIDE_ICON_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="pt-1">
            {readOnly ? (
              <div className="text-sm" style={{ color: accent }}>{templateConfig.approval_page_back_to_login_label || ''}</div>
            ) : (
              <input className="input h-9" value={templateConfig.approval_page_back_to_login_label || ''} onChange={e => setField('approval_page_back_to_login_label', e.target.value)} placeholder="Back to login label" />
            )}
          </div>
        </aside>
      </div>

      <div className="pt-3 text-center text-xs text-gray-500">
        {readOnly ? (
          <span>{footerPreview}</span>
        ) : (
          <input className="input mx-auto max-w-lg h-9" value={templateConfig.approval_page_footer_text || ''} onChange={e => setField('approval_page_footer_text', e.target.value)} placeholder="Footer text (use {app_name})" />
        )}
      </div>
    </div>
  )
}

export default function Licenses() {
  const [tab, setTab] = useState('licenses')

  const [licenses, setLicenses] = useState([])
  const [licensesTotal, setLicensesTotal] = useState(0)
  const [licensesPage, setLicensesPage] = useState(1)
  const [licensesLimit, setLicensesLimit] = useState(25)
  const [licensesQ, setLicensesQ] = useState('')

  const [suppliers, setSuppliers] = useState([])
  const [supplierLookup, setSupplierLookup] = useState([])
  const [suppliersTotal, setSuppliersTotal] = useState(0)
  const [suppliersPage, setSuppliersPage] = useState(1)
  const [suppliersLimit, setSuppliersLimit] = useState(25)
  const [suppliersQ, setSuppliersQ] = useState('')

  const [assetQ, setAssetQ] = useState('')
  const [serviceQ, setServiceQ] = useState('')

  const [assets, setAssets] = useState([])
  const [services, setServices] = useState([])
  const [localUsers, setLocalUsers] = useState([])
  const [formLookupsLoaded, setFormLookupsLoaded] = useState(false)
  const [loadingFormLookups, setLoadingFormLookups] = useState(false)

  const [showLicenseForm, setShowLicenseForm] = useState(false)
  const [editingLicense, setEditingLicense] = useState(null)
  const [licenseActionConfirm, setLicenseActionConfirm] = useState(null)
  const [licenseForm, setLicenseForm] = useState(emptyLicenseForm)

  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [supplierDeleteTarget, setSupplierDeleteTarget] = useState(null)
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm)
  const [showSupplierPicker, setShowSupplierPicker] = useState(false)
  const [supplierPickerQ, setSupplierPickerQ] = useState('')

  const [ownerResults, setOwnerResults] = useState([])
  const [ownerSearching, setOwnerSearching] = useState(false)
  const [maintResults, setMaintResults] = useState([])
  const [maintSearching, setMaintSearching] = useState(false)
  const [approverResults, setApproverResults] = useState([])
  const [approverSearching, setApproverSearching] = useState(false)
  const [templateConfig, setTemplateConfig] = useState(templateDefaults)
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateSaving, setTemplateSaving] = useState(false)
  const [templateUploading, setTemplateUploading] = useState(false)
  const [showTemplatePreview, setShowTemplatePreview] = useState(false)
  const [showQuickCreateUser, setShowQuickCreateUser] = useState(false)
  const [quickCreateContactTarget, setQuickCreateContactTarget] = useState('owner_contacts')
  const [autoSelectCreatedSupplier, setAutoSelectCreatedSupplier] = useState(false)

  const loadLicenses = async () => {
    const r = await licensesApi.list({ page: licensesPage, limit: licensesLimit, q: licensesQ })
    setLicenses(r.data?.data || [])
    setLicensesTotal(r.data?.total || 0)
  }

  const loadSuppliers = async () => {
    const r = await suppliersApi.list({ page: suppliersPage, limit: suppliersLimit, q: suppliersQ })
    setSuppliers(r.data?.data || [])
    setSuppliersTotal(r.data?.total || 0)
  }

  useEffect(() => {
    if (tab === 'licenses') loadLicenses().catch(() => {})
  }, [tab, licensesPage, licensesLimit, licensesQ])

  useEffect(() => {
    if (tab === 'suppliers') loadSuppliers().catch(() => {})
  }, [tab, suppliersPage, suppliersLimit, suppliersQ])

  useEffect(() => {
    if (tab !== 'template') return
    setTemplateLoading(true)
    settingsApi.getGeneral()
      .then(r => {
        const data = r.data || {}
        setTemplateConfig({ ...templateDefaults, ...data })
      })
      .catch(() => {
        setTemplateConfig(templateDefaults)
        toast.error('Cannot load template settings')
      })
      .finally(() => setTemplateLoading(false))
  }, [tab])

  useEffect(() => {
    if (!showLicenseForm || formLookupsLoaded || loadingFormLookups) return

    setLoadingFormLookups(true)
    Promise.all([
      assetsApi.list({ limit: 300 }).catch(() => ({ data: [] })),
      servicesApi.list({ limit: 300 }).catch(() => ({ data: [] })),
      usersApi.list({ limit: 500 }).catch(() => ({ data: [] })),
      suppliersApi.list({ page: 1, limit: 200 }).catch(() => ({ data: { data: [] } })),
    ])
      .then(([assetsRes, servicesRes, usersRes, suppliersRes]) => {
        setAssets(Array.isArray(assetsRes.data) ? assetsRes.data : (assetsRes.data?.data || []))
        setServices(Array.isArray(servicesRes.data) ? servicesRes.data : (servicesRes.data?.data || []))
        setLocalUsers(Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data?.data || []))
        setSupplierLookup(suppliersRes.data?.data || [])
        setFormLookupsLoaded(true)
      })
      .finally(() => setLoadingFormLookups(false))
  }, [showLicenseForm, formLookupsLoaded, loadingFormLookups])

  const supplierOptions = useMemo(() => supplierLookup.map(s => ({ id: s.id, label: `${s.company} - ${s.first_name} ${s.last_name}` })), [supplierLookup])
  const selectedSupplierLabel = useMemo(() => {
    const found = supplierOptions.find(s => s.id === licenseForm.supplier_id)
    return found?.label || 'No supplier selected'
  }, [supplierOptions, licenseForm.supplier_id])
  const filteredSupplierOptions = useMemo(() => {
    const q = supplierPickerQ.trim().toLowerCase()
    if (!q) return supplierOptions
    return supplierOptions.filter(s => s.label.toLowerCase().includes(q))
  }, [supplierOptions, supplierPickerQ])

  const filteredAssets = useMemo(() => {
    const q = assetQ.trim().toLowerCase()
    const base = q ? assets.filter(a => String(a.name || '').toLowerCase().includes(q)) : assets
    return base.slice(0, 25)
  }, [assets, assetQ])

  const filteredServices = useMemo(() => {
    const q = serviceQ.trim().toLowerCase()
    const base = q ? services.filter(s => String(s.name || '').toLowerCase().includes(q)) : services
    return base.slice(0, 25)
  }, [services, serviceQ])

  const openCreateLicense = () => {
    setEditingLicense(null)
    setLicenseForm(emptyLicenseForm)
    setAssetQ('')
    setServiceQ('')
    setShowLicenseForm(true)
  }

  const openEditLicense = async (row) => {
    try {
      const r = await licensesApi.get(row.id)
      const d = r.data || {}
      setEditingLicense(d)
      setLicenseForm({
        ...emptyLicenseForm,
        name: d.name || '',
        description: d.description || '',
        supplier_id: d.supplier_id || '',
        owner_contacts: extractContactList(d.owner_contact),
        maintainer_contacts: extractContactList(d.maintainer_contact),
        approver_contacts: extractContactList(d.approver_contact),
        activation_date: d.activation_date ? String(d.activation_date).slice(0, 10) : '',
        duration_months: String(d.duration_months || 12),
        expiry_mode: d.custom_expiry_date || (!d.activation_date && d.expiry_date) ? 'custom' : 'duration',
        expiry_date: d.custom_expiry_date ? String(d.custom_expiry_date).slice(0, 10) : (d.expiry_date ? String(d.expiry_date).slice(0, 10) : ''),
        reminder_days: d.reminder_days || 30,
        approval_required: d.approval_required !== false,
        approval_status: d.approval_status || 'pending',
        estimated_cost: d.estimated_cost ?? '',
        currency: d.currency || 'EUR',
        notes: d.notes || '',
        documents: Array.isArray(d.documents) ? d.documents : [],
        asset_ids: Array.isArray(d.assets) ? d.assets.map(a => a.id) : [],
        service_ids: Array.isArray(d.services) ? d.services.map(s => s.id) : [],
      })
      setAssetQ('')
      setServiceQ('')
      setShowLicenseForm(true)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error loading license')
    }
  }

  const saveLicense = async (e) => {
    e.preventDefault()
    try {
      const payload = toLicensePayload(licenseForm)
      if (editingLicense?.id) {
        await licensesApi.update(editingLicense.id, payload)
        toast.success('License updated')
      } else {
        await licensesApi.create(payload)
        toast.success('License created')
      }
      setShowLicenseForm(false)
      await loadLicenses()
    } catch (err) {
      const errs = err.response?.data?.errors
      const msg = errs ? errs.map(x => `${x.path}: ${x.msg}`).join(' • ') : (err.response?.data?.error || 'Error')
      toast.error(msg)
    }
  }

  const approve = async (id) => {
    try {
      await licensesApi.approve(id)
      toast.success('License approved')
      await loadLicenses()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error')
    }
  }

  const reject = async (id) => {
    try {
      await licensesApi.reject(id, 'Rejected from license list')
      toast.success('License rejected')
      await loadLicenses()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error')
    }
  }

  const requestApproval = async (id) => {
    try {
      const r = await licensesApi.requestApproval(id, { expiry_hours: 72 })
      toast.success(r.data?.message || 'Approval email sent')
      await loadLicenses()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error sending approval email')
    }
  }

  const openLicenseActionConfirm = (type, target) => {
    const id = target?.id
    const name = target?.name || 'this license'
    if (!id) return

    if (type === 'request-approval') {
      setLicenseActionConfirm({
        title: 'Send approval request',
        message: `Send approval request for "${name}"?`,
        confirmLabel: 'Send',
        danger: false,
        action: async () => {
          await requestApproval(id)
        },
      })
      return
    }

    if (type === 'approve') {
      setLicenseActionConfirm({
        title: 'Approve license',
        message: `Approve "${name}"?`,
        confirmLabel: 'Approve',
        danger: false,
        action: async () => {
          await approve(id)
        },
      })
      return
    }

    if (type === 'reject') {
      setLicenseActionConfirm({
        title: 'Reject license',
        message: `Reject "${name}"?`,
        confirmLabel: 'Reject',
        danger: true,
        action: async () => {
          await reject(id)
        },
      })
      return
    }

    if (type === 'delete') {
      setLicenseActionConfirm({
        title: 'Delete license',
        message: `Delete "${name}"?`,
        confirmLabel: 'Delete',
        danger: true,
        action: async () => {
          await licensesApi.delete(id)
          toast.success('License deleted')
          setShowLicenseForm(false)
          setEditingLicense(null)
          await loadLicenses()
        },
      })
    }
  }

  const confirmLicenseAction = async () => {
    if (!licenseActionConfirm?.action) return
    try {
      await licenseActionConfirm.action()
    } catch {
      // Individual action handlers already show toast errors.
    } finally {
      setLicenseActionConfirm(null)
    }
  }

  const openCreateSupplier = () => {
    setEditingSupplier(null)
    setSupplierForm(emptySupplierForm)
    setShowSupplierForm(true)
  }

  const openCreateSupplierFromPicker = () => {
    setAutoSelectCreatedSupplier(true)
    setShowSupplierPicker(false)
    setSupplierPickerQ('')
    openCreateSupplier()
  }

  const openEditSupplier = (row) => {
    setEditingSupplier(row)
    setSupplierForm({
      first_name: row.first_name || '',
      last_name: row.last_name || '',
      company: row.company || '',
      nationality: row.nationality || '',
      phone: row.phone || '',
      mobile: row.mobile || '',
      email: row.email || '',
      vat_number: row.vat_number || '',
      notes: row.notes || '',
      website: row.website || '',
      contract_reference: row.contract_reference || '',
      contract_start_date: row.contract_start_date ? String(row.contract_start_date).slice(0, 10) : '',
      contract_end_date: row.contract_end_date ? String(row.contract_end_date).slice(0, 10) : '',
      availability_hours: row.availability_hours || '',
      emergency_phone: row.emergency_phone || '',
      emergency_email: row.emergency_email || '',
      sla_resolution_hours: row.sla_resolution_hours ?? '',
      contract_notes: row.contract_notes || '',
      contract_documents: Array.isArray(row.contract_documents) ? row.contract_documents : [],
    })
    setShowSupplierForm(true)
  }

  const saveSupplier = async (e) => {
    e.preventDefault()
    try {
      const payload = normalizeSupplierPayload(supplierForm)
      if (editingSupplier?.id) {
        await suppliersApi.update(editingSupplier.id, payload)
        toast.success('Supplier updated')
        setAutoSelectCreatedSupplier(false)
      } else {
        const res = await suppliersApi.create(payload)
        if (autoSelectCreatedSupplier && res.data?.id) {
          setLicenseForm(prev => ({ ...prev, supplier_id: res.data.id }))
        }
        toast.success('Supplier created')
        setAutoSelectCreatedSupplier(false)
      }
      setShowSupplierForm(false)
      await loadSuppliers()
      suppliersApi.list({ page: 1, limit: 100 }).then(r => setSupplierLookup(r.data?.data || [])).catch(() => {})
    } catch (err) {
      setAutoSelectCreatedSupplier(false)
      const errs = err.response?.data?.errors
      const msg = errs ? errs.map(x => `${x.path}: ${x.msg}`).join(' • ') : (err.response?.data?.error || 'Error')
      toast.error(msg)
    }
  }

  const openQuickCreateUserFor = (targetField) => {
    setQuickCreateContactTarget(targetField)
    setShowQuickCreateUser(true)
  }

  const removeSupplier = async () => {
    if (!supplierDeleteTarget) return
    try {
      await suppliersApi.delete(supplierDeleteTarget.id)
      toast.success('Supplier deleted')
      setSupplierDeleteTarget(null)
      await loadSuppliers()
      suppliersApi.list({ page: 1, limit: 100 }).then(r => setSupplierLookup(r.data?.data || [])).catch(() => {})
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error')
    }
  }

  const uploadSupplierDoc = async (files) => {
    const list = Array.from(files || [])
    if (list.length === 0) return
    try {
      const uploaded = []
      for (const f of list) {
        const r = await uploadsApi.uploadSupplierDocument(f)
        uploaded.push(r.data)
      }
      setSupplierForm(prev => ({ ...prev, contract_documents: [...(prev.contract_documents || []), ...uploaded] }))
      toast.success(`${uploaded.length} file(s) uploaded`)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload error')
    }
  }

  const searchOwnerLocalOrLdap = async (q) => {
    if (!q || q.length < 1) {
      setOwnerSearching(false)
      setOwnerResults([])
      return
    }
    setOwnerSearching(true)
    try {
      const local = localUsers
        .filter(u => {
          const qq = q.toLowerCase()
          return String(u.username || '').toLowerCase().includes(qq)
            || String(u.display_name || '').toLowerCase().includes(qq)
            || String(u.email || '').toLowerCase().includes(qq)
        })
        .slice(0, 25)
        .map(u => ({ type: 'local', id: u.id, name: u.display_name || u.username, email: u.email, username: u.username }))

      const r = await settingsApi.searchLdapUsers(q).catch(() => ({ data: [] }))
      const ldap = (r.data || []).map(u => ({ type: 'ldap', name: u.name, email: u.email, dn: u.dn, username: u.username }))
      setOwnerResults(mergeUniqueContacts(local, ldap))
    } catch {
      setOwnerResults([])
    } finally {
      setOwnerSearching(false)
    }
  }

  const searchMaintOrApprover = async (q, setLoading, setResults) => {
    if (!q || q.length < 1) {
      setLoading(false)
      setResults([])
      return
    }
    setLoading(true)
    try {
      const [ldapRes, supRes] = await Promise.all([
        settingsApi.searchLdapUsers(q).catch(() => ({ data: [] })),
        suppliersApi.list({ q, page: 1, limit: 25 }).catch(() => ({ data: { data: [] } })),
      ])
      const local = localUsers
        .filter(u => {
          const qq = q.toLowerCase()
          return String(u.username || '').toLowerCase().includes(qq)
            || String(u.display_name || '').toLowerCase().includes(qq)
            || String(u.email || '').toLowerCase().includes(qq)
        })
        .slice(0, 25)
        .map(u => ({ type: 'local', id: u.id, name: u.display_name || u.username, email: u.email, username: u.username }))
      const ldap = (ldapRes.data || []).map(u => ({ type: 'ldap', name: u.name, email: u.email, dn: u.dn, username: u.username }))
      const sups = (supRes.data?.data || []).map(s => ({
        type: 'supplier',
        id: s.id,
        name: `${s.first_name} ${s.last_name}`,
        company: s.company,
        email: s.email,
        mobile: s.mobile,
        phone: s.phone,
      }))
      setResults(mergeUniqueContacts(mergeUniqueContacts(local, ldap), sups))
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  const uploadDocs = async (files) => {
    const list = Array.from(files || [])
    if (list.length === 0) return
    try {
      const uploaded = []
      for (const f of list) {
        const r = await uploadsApi.uploadLicenseDocument(f)
        uploaded.push(r.data)
      }
      setLicenseForm(prev => ({ ...prev, documents: [...(prev.documents || []), ...uploaded] }))
      toast.success(`${uploaded.length} file(s) uploaded`)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload error')
    }
  }

  const uploadTemplateLogo = async (file) => {
    if (!file) return
    try {
      setTemplateUploading(true)
      const r = await uploadsApi.uploadLicenseTemplateLogo(file)
      setTemplateConfig(prev => ({ ...prev, approval_page_logo_url: r.data?.url || '' }))
      toast.success('Logo uploaded')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Logo upload error')
    } finally {
      setTemplateUploading(false)
    }
  }

  const saveTemplate = async (e) => {
    e.preventDefault()
    try {
      setTemplateSaving(true)
      await settingsApi.saveGeneral(templateConfig)
      toast.success('Template settings saved')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error saving template settings')
    } finally {
      setTemplateSaving(false)
    }
  }

  const toggleMulti = (arr, id) => arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]

  return (
    <Layout title="Licenses">
      <div className="space-y-4">
        <div className="py-2 -mx-4 sm:mx-0 px-4 sm:px-0 border-b border-gray-200 dark:border-gray-700">
          <nav className="flex flex-wrap gap-1.5">
            {[['licenses', 'Licenses', FileIconFallback], ['suppliers', 'Suppliers', Building2], ['template', 'Template', Palette]].map(([k, l, Icon]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-full transition-colors inline-flex items-center gap-1.5 ${
                  tab === k ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                <Icon size={14} />
                {l}
              </button>
            ))}
          </nav>
        </div>

        {tab === 'licenses' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <input className="input w-full sm:w-80" placeholder="Search licenses..." value={licensesQ} onChange={e => { setLicensesQ(e.target.value); setLicensesPage(1) }} />
              <button className="btn-primary" onClick={openCreateLicense}><Plus size={15} />New License</button>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>{['Name', 'Supplier', 'Owner', 'Approver', 'Expiry', 'Status', 'Scope', 'Open'].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {licenses.map(l => (
                      <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer" onDoubleClick={() => openEditLicense(l)} title="Double click for details">
                        <td className="px-4 py-3 font-medium">{l.name}</td>
                        <td className="px-4 py-3 text-gray-500">{l.supplier_company || l.supplier || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{l.owner_name || contactSummary(l.owner_contact)}</td>
                        <td className="px-4 py-3 text-gray-500">{l.approver_name || contactSummary(l.approver_contact)}</td>
                        <td className="px-4 py-3 text-gray-500">{l.expiry_date ? String(l.expiry_date).slice(0, 10) : '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${approvalStatusMeta(l.approval_status, l.approval_required !== false).cls}`}>
                            {approvalStatusMeta(l.approval_status, l.approval_required !== false).label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{l.asset_count || 0} assets • {l.service_count || 0} services</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button className="action-icon-btn" onClick={() => openEditLicense(l)} title="Edit"><Pencil size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {licenses.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-500">No licenses</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="p-4"><Pagination page={licensesPage} limit={licensesLimit} total={licensesTotal} onChange={setLicensesPage} onLimitChange={setLicensesLimit} /></div>
            </div>
          </div>
        )}

        {tab === 'suppliers' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <input className="input w-full sm:w-80" placeholder="Search suppliers..." value={suppliersQ} onChange={e => { setSuppliersQ(e.target.value); setSuppliersPage(1) }} />
              <button className="btn-secondary" onClick={openCreateSupplier}><Plus size={15} />New Supplier</button>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-[760px] w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>{['First name', 'Last name', 'Company', 'Email', 'Phone', 'Mobile', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {suppliers.map(s => (
                      <tr key={s.id}>
                        <td className="px-4 py-3">{s.first_name}</td>
                        <td className="px-4 py-3">{s.last_name}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span>{s.company}</span>
                            {s.website ? (
                              <a
                                href={s.website.startsWith('http') ? s.website : `https://${s.website}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open supplier website"
                                className="inline-flex items-center gap-1 text-brand-600 hover:underline"
                              >
                                <SupplierFavicon url={s.website} />
                              </a>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{s.email}</td>
                        <td className="px-4 py-3 text-gray-500">{s.phone || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{s.mobile || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button className="action-icon-btn" onClick={() => openEditSupplier(s)} title="Edit"><Pencil size={14} /></button>
                            <button className="action-icon-btn action-icon-btn-danger" onClick={() => setSupplierDeleteTarget(s)} title="Delete"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {suppliers.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-500">No suppliers</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="p-4"><Pagination page={suppliersPage} limit={suppliersLimit} total={suppliersTotal} onChange={setSuppliersPage} onLimitChange={setSuppliersLimit} /></div>
            </div>
          </div>
        )}

        {tab === 'template' && (
          <div className="space-y-4">
            <div className="card p-5 sm:p-6">
              {templateLoading ? (
                <p className="text-sm text-gray-500">Loading template settings...</p>
              ) : (
                <form onSubmit={saveTemplate} className="space-y-6">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-sm text-gray-500">Edit texts directly in the same visual position where they appear on the approval page.</p>
                    <button type="button" className="btn-secondary" onClick={() => setShowTemplatePreview(true)}>
                      <Eye size={15} />Preview popup
                    </button>
                  </div>

                  <TemplateVisualEditor
                    templateConfig={templateConfig}
                    setTemplateConfig={setTemplateConfig}
                    templateUploading={templateUploading}
                    onUploadLogo={uploadTemplateLogo}
                  />

                  <div className="flex justify-end">
                    <button type="submit" className="btn-primary" disabled={templateSaving || templateLoading}>
                      <Save size={15} />{templateSaving ? 'Saving...' : 'Save Template'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>

      {showTemplatePreview && (
        <Modal title="Template Preview" onClose={() => setShowTemplatePreview(false)} size="xl">
          <TemplateVisualEditor
            templateConfig={templateConfig}
            setTemplateConfig={setTemplateConfig}
            templateUploading={false}
            onUploadLogo={() => {}}
            readOnly
          />
        </Modal>
      )}

      {showLicenseForm && (
        <Modal title={editingLicense ? `Edit license: ${editingLicense.name}` : 'New license'} onClose={() => setShowLicenseForm(false)} size="xl">
          <form onSubmit={saveLicense} className="space-y-4">
            {editingLicense?.id && (
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-3 py-2.5 flex flex-wrap gap-2 items-center">
                <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 mr-1">License actions</span>
                {licenseForm.approval_required && (
                  <>
                    <button type="button" className="action-text-btn" onClick={() => openLicenseActionConfirm('request-approval', editingLicense)} title="Request approval email">Send approval</button>
                    <button type="button" className="action-icon-btn action-icon-btn-success" onClick={() => openLicenseActionConfirm('approve', editingLicense)} title="Approve"><CheckCircle2 size={14} /></button>
                    <button type="button" className="action-icon-btn action-icon-btn-warn" onClick={() => openLicenseActionConfirm('reject', editingLicense)} title="Reject"><XCircle size={14} /></button>
                  </>
                )}
                <button type="button" className="action-icon-btn action-icon-btn-danger" onClick={() => openLicenseActionConfirm('delete', editingLicense)} title="Delete"><Trash2 size={14} /></button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name *</label>
                <input className="input" required value={licenseForm.name} onChange={e => setLicenseForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Supplier</label>
                <button type="button" className="input text-left w-full" onClick={() => setShowSupplierPicker(true)}>
                  {selectedSupplierLabel}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input min-h-[80px]" value={licenseForm.description} onChange={e => setLicenseForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <ContactPicker
                label="Owner (Local or LDAP)"
                placeholder="Search local or LDAP user..."
                value={licenseForm.owner_contacts}
                loading={ownerSearching}
                results={ownerResults}
                onSearch={searchOwnerLocalOrLdap}
                onChange={(items) => setLicenseForm(f => ({ ...f, owner_contacts: items }))}
                createActions={[
                  { label: '+ New User', onClick: () => openQuickCreateUserFor('owner_contacts') },
                ]}
              />
              <ContactPicker
                label="Maintainer (Local, LDAP or Suppliers)"
                placeholder="Search local/LDAP user or supplier..."
                value={licenseForm.maintainer_contacts}
                loading={maintSearching}
                results={maintResults}
                onSearch={(q) => searchMaintOrApprover(q, setMaintSearching, setMaintResults)}
                onChange={(items) => setLicenseForm(f => ({ ...f, maintainer_contacts: items }))}
                createActions={[
                  { label: '+ New Supplier', onClick: openCreateSupplierFromPicker },
                  { label: '+ New User', onClick: () => openQuickCreateUserFor('maintainer_contacts') },
                ]}
              />
              <ContactPicker
                label="Approver (Local, LDAP or Suppliers)"
                placeholder="Search local/LDAP user or supplier..."
                value={licenseForm.approver_contacts}
                loading={approverSearching}
                results={approverResults}
                onSearch={(q) => searchMaintOrApprover(q, setApproverSearching, setApproverResults)}
                onChange={(items) => setLicenseForm(f => ({ ...f, approver_contacts: items }))}
                createActions={[
                  { label: '+ New Supplier', onClick: openCreateSupplierFromPicker },
                  { label: '+ New User', onClick: () => openQuickCreateUserFor('approver_contacts') },
                ]}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Activation date</label>
                <input className="input" type="date" value={licenseForm.activation_date} onChange={e => setLicenseForm(f => ({ ...f, activation_date: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Expiry mode</label>
                <select className="input" value={licenseForm.expiry_mode} onChange={e => setLicenseForm(f => ({ ...f, expiry_mode: e.target.value }))}>
                  <option value="duration">Duration from activation</option>
                  <option value="custom">Custom expiry date</option>
                </select>
              </div>
              {licenseForm.expiry_mode === 'duration' ? (
                <div>
                  <label className="block text-sm font-medium mb-1">Duration months</label>
                  <select className="input" value={licenseForm.duration_months} onChange={e => setLicenseForm(f => ({ ...f, duration_months: e.target.value }))}>
                    {[12, 24, 36, 48, 60].map(months => <option key={months} value={String(months)}>{months} months</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1">Custom expiry date</label>
                  <input className="input" type="date" value={licenseForm.expiry_date} onChange={e => setLicenseForm(f => ({ ...f, expiry_date: e.target.value }))} />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">Reminder days</label>
                <input className="input" type="number" min="1" max="365" value={licenseForm.reminder_days} onChange={e => setLicenseForm(f => ({ ...f, reminder_days: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Approval status</label>
                <div className="input flex items-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${approvalStatusMeta(licenseForm.approval_status, licenseForm.approval_required !== false).cls}`}>
                    {approvalStatusMeta(licenseForm.approval_status, licenseForm.approval_required !== false).label}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Estimated cost</label>
                <input className="input" type="number" step="0.01" value={licenseForm.estimated_cost} onChange={e => setLicenseForm(f => ({ ...f, estimated_cost: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Currency</label>
                <input className="input" value={licenseForm.currency} onChange={e => setLicenseForm(f => ({ ...f, currency: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2 pt-7">
                <input id="approval_required" type="checkbox" checked={!!licenseForm.approval_required} onChange={e => setLicenseForm(f => ({ ...f, approval_required: e.target.checked }))} />
                <label htmlFor="approval_required" className="text-sm">Approval required</label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Documents</label>
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer text-sm">
                <Upload size={14} />Upload file(s)
                <input type="file" className="hidden" multiple onChange={e => uploadDocs(e.target.files)} />
              </label>
              <div className="mt-2 space-y-1">
                {(licenseForm.documents || []).map((d, i) => (
                  <div key={`${d.url || 'doc'}-${i}`} className="flex items-center justify-between gap-2 text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1.5">
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline truncate">{d.name || d.url}</a>
                    <button type="button" className="text-red-500 hover:underline" onClick={() => setLicenseForm(f => ({ ...f, documents: (f.documents || []).filter((_, idx) => idx !== i) }))}>Remove</button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea className="input min-h-[80px]" value={licenseForm.notes} onChange={e => setLicenseForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium">Assign assets</label>
                  <span className="text-xs text-gray-400">{licenseForm.asset_ids.length} selected</span>
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className="input pl-8" placeholder="Search assets..." value={assetQ} onChange={e => setAssetQ(e.target.value)} />
                </div>
                <div className="max-h-44 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2 space-y-1">
                  {filteredAssets.map(a => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={licenseForm.asset_ids.includes(a.id)} onChange={() => setLicenseForm(f => ({ ...f, asset_ids: toggleMulti(f.asset_ids, a.id) }))} />
                      <span>{a.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium">Assign services</label>
                  <span className="text-xs text-gray-400">{licenseForm.service_ids.length} selected</span>
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className="input pl-8" placeholder="Search services..." value={serviceQ} onChange={e => setServiceQ(e.target.value)} />
                </div>
                <div className="max-h-44 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2 space-y-1">
                  {filteredServices.map(s => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={licenseForm.service_ids.includes(s.id)} onChange={() => setLicenseForm(f => ({ ...f, service_ids: toggleMulti(f.service_ids, s.id) }))} />
                      <span>{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setShowLicenseForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}

      {showSupplierForm && (
        <Modal title={editingSupplier ? `Edit supplier: ${editingSupplier.company}` : 'New supplier'} onClose={() => setShowSupplierForm(false)} size="lg">
          <form onSubmit={saveSupplier} className="space-y-4">
            <SupplierFormTabbed value={supplierForm} onChange={setSupplierForm} onUploadDoc={uploadSupplierDoc} />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowSupplierForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}

      {showSupplierPicker && (
        <Modal title="Select Supplier" onClose={() => { setShowSupplierPicker(false); setSupplierPickerQ('') }} size="lg">
          <div className="space-y-3">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-8"
                placeholder="Search suppliers..."
                value={supplierPickerQ}
                onChange={e => setSupplierPickerQ(e.target.value)}
              />
            </div>
            <div className="max-h-[52vh] overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50"
                onClick={openCreateSupplierFromPicker}
              >
                + New Supplier
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50"
                onClick={() => {
                  setLicenseForm(f => ({ ...f, supplier_id: '' }))
                  setShowSupplierPicker(false)
                  setSupplierPickerQ('')
                }}
              >
                No supplier
              </button>
              {filteredSupplierOptions.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 ${licenseForm.supplier_id === s.id ? 'bg-brand-50 text-brand-700' : ''}`}
                  onClick={() => {
                    setLicenseForm(f => ({ ...f, supplier_id: s.id }))
                    setShowSupplierPicker(false)
                    setSupplierPickerQ('')
                  }}
                >
                  {s.label}
                </button>
              ))}
              {filteredSupplierOptions.length === 0 && <div className="px-3 py-3 text-sm text-gray-500">No suppliers found.</div>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => { setShowSupplierPicker(false); setSupplierPickerQ('') }}>Close</button>
            </div>
          </div>
        </Modal>
      )}

      <QuickCreateUserModal
        open={showQuickCreateUser}
        onClose={() => setShowQuickCreateUser(false)}
        localGroups={[]}
        onCreated={(createdUser) => {
          const nextContact = {
            type: 'local_user',
            id: createdUser.id,
            name: createdUser.display_name || createdUser.username,
            username: createdUser.username,
            email: createdUser.email || '',
          }
          setLicenseForm(f => ({
            ...f,
            [quickCreateContactTarget]: dedupeContacts([...(f[quickCreateContactTarget] || []), nextContact]),
          }))
        }}
      />

      {supplierDeleteTarget && (
        <ConfirmDialog
          title="Delete supplier"
          message={`Delete supplier "${supplierDeleteTarget.company}"?`}
          danger
          confirmLabel="Delete"
          onConfirm={removeSupplier}
          onCancel={() => setSupplierDeleteTarget(null)}
        />
      )}

      {licenseActionConfirm && (
        <ConfirmDialog
          title={licenseActionConfirm.title}
          message={licenseActionConfirm.message}
          danger={!!licenseActionConfirm.danger}
          confirmLabel={licenseActionConfirm.confirmLabel || 'Confirm'}
          onConfirm={confirmLicenseAction}
          onCancel={() => setLicenseActionConfirm(null)}
        />
      )}
    </Layout>
  )
}

function FileIconFallback(props) {
  return <UserRound {...props} />
}
