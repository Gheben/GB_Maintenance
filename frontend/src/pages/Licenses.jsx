import { useEffect, useMemo, useState } from 'react'
import { Layout } from '../components/Layout'
import { licensesApi, suppliersApi, assetsApi, servicesApi, settingsApi, uploadsApi, usersApi } from '../api'
import { Pagination } from '../components/Pagination'
import { Modal, ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { Plus, Pencil, Trash2, CheckCircle2, XCircle, Upload, Search, Building2, UserRound, Save, Palette, Eye } from 'lucide-react'

const emptyLicenseForm = {
  name: '',
  description: '',
  supplier_id: '',
  owner_contact: null,
  maintainer_contact: null,
  approver_contact: null,
  expiry_date: '',
  renewal_date: '',
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
  approval_page_side_point_1: 'Company/app name shown in the public header',
  approval_page_side_point_2: 'Custom title and subtitle for approval requests',
  approval_page_side_point_3: 'Company logo uploaded from Licenses > Template',
  approval_page_side_point_4: 'Primary accent color used for CTA and highlights',
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
  return {
    ...form,
    supplier_id: form.supplier_id || null,
    owner_contact: form.owner_contact || null,
    owner_user_id: null,
    maintainer_contact: form.maintainer_contact || null,
    maintainer_user_id: null,
    approver_contact: form.approver_contact || null,
    approver_user_id: null,
    expiry_date: form.expiry_date || null,
    renewal_date: form.renewal_date || null,
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
          <input className="input" value={value.nationality} onChange={e => set('nationality', e.target.value)} />
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

function ContactPicker({ label, placeholder, value, onSelect, onClear, onSearch, loading, results }) {
  const [q, setQ] = useState('')
  const canSearch = q.trim().length >= 2

  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length >= 2) {
        onSearch(q.trim())
      } else {
        onSearch('')
      }
    }, 250)
    return () => clearTimeout(t)
  }, [q, onSearch])

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium mb-1">{label}</label>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="input pl-8"
          placeholder={placeholder}
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>
      <p className="text-xs text-gray-400 min-h-4"> </p>
      {canSearch && Array.isArray(results) && results.length > 0 && (
        <div className="max-h-36 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-1 space-y-1">
          {results.map((r, idx) => (
            <button
              type="button"
              key={`${r.type || 'x'}-${r.id || r.dn || idx}`}
              onClick={() => {
                onSelect(r)
                setQ('')
                onSearch('')
              }}
              className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50 text-xs"
            >
              <div className="font-medium text-gray-800 dark:text-gray-100">{r.name || r.company || r.email || r.dn}</div>
              <div className="text-gray-500">{[r.email, r.mobile || r.phone].filter(Boolean).join(' • ')}</div>
            </button>
          ))}
        </div>
      )}
      {value && (
        <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs">
          <span className="text-blue-700">{formatContact(value)}</span>
          <button type="button" className="action-text-btn" onClick={() => { onClear(); setQ(''); onSearch('') }}>Clear</button>
        </div>
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
  const sidePoints = [1, 2, 3, 4].map(i => `approval_page_side_point_${i}`)
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
            {sidePoints.map((key, idx) => (
              <div key={key} className="rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-2 text-sm">
                {readOnly ? (
                  <div>{templateConfig[key] || ''}</div>
                ) : (
                  <input className="input h-8" value={templateConfig[key] || ''} onChange={e => setField(key, e.target.value)} placeholder={`Sidebar bullet ${idx + 1}`} />
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

  const [showLicenseForm, setShowLicenseForm] = useState(false)
  const [editingLicense, setEditingLicense] = useState(null)
  const [licenseDeleteTarget, setLicenseDeleteTarget] = useState(null)
  const [licenseForm, setLicenseForm] = useState(emptyLicenseForm)

  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [supplierDeleteTarget, setSupplierDeleteTarget] = useState(null)
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm)

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
    assetsApi.list({ limit: 300 }).then(r => setAssets(Array.isArray(r.data) ? r.data : (r.data.data || []))).catch(() => {})
    servicesApi.list({ limit: 300 }).then(r => setServices(Array.isArray(r.data) ? r.data : (r.data.data || []))).catch(() => {})
    usersApi.list({ limit: 500 }).then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data.data || [])
      setLocalUsers(list)
    }).catch(() => {})
    suppliersApi.list({ page: 1, limit: 100 }).then(r => setSupplierLookup(r.data?.data || [])).catch(() => {})
  }, [])

  const supplierOptions = useMemo(() => supplierLookup.map(s => ({ id: s.id, label: `${s.company} - ${s.first_name} ${s.last_name}` })), [supplierLookup])

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
        name: d.name || '',
        description: d.description || '',
        supplier_id: d.supplier_id || '',
        owner_contact: d.owner_contact || null,
        maintainer_contact: d.maintainer_contact || null,
        approver_contact: d.approver_contact || null,
        expiry_date: d.expiry_date ? String(d.expiry_date).slice(0, 10) : '',
        renewal_date: d.renewal_date ? String(d.renewal_date).slice(0, 10) : '',
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

  const removeLicense = async () => {
    if (!licenseDeleteTarget) return
    try {
      await licensesApi.delete(licenseDeleteTarget.id)
      toast.success('License deleted')
      setLicenseDeleteTarget(null)
      await loadLicenses()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error')
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

  const openCreateSupplier = () => {
    setEditingSupplier(null)
    setSupplierForm(emptySupplierForm)
    setShowSupplierForm(true)
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
    })
    setShowSupplierForm(true)
  }

  const saveSupplier = async (e) => {
    e.preventDefault()
    try {
      if (editingSupplier?.id) {
        await suppliersApi.update(editingSupplier.id, supplierForm)
        toast.success('Supplier updated')
      } else {
        await suppliersApi.create(supplierForm)
        toast.success('Supplier created')
      }
      setShowSupplierForm(false)
      await loadSuppliers()
      suppliersApi.list({ page: 1, limit: 100 }).then(r => setSupplierLookup(r.data?.data || [])).catch(() => {})
    } catch (err) {
      const errs = err.response?.data?.errors
      const msg = errs ? errs.map(x => `${x.path}: ${x.msg}`).join(' • ') : (err.response?.data?.error || 'Error')
      toast.error(msg)
    }
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

  const searchOwnerLocalOrLdap = async (q) => {
    if (!q || q.length < 2) {
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
    if (!q || q.length < 2) {
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
                    <tr>{['Name', 'Supplier', 'Owner', 'Approver', 'Expiry', 'Status', 'Scope', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {licenses.map(l => (
                      <tr key={l.id}>
                        <td className="px-4 py-3 font-medium">{l.name}</td>
                        <td className="px-4 py-3 text-gray-500">{l.supplier_company || l.supplier || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{l.owner_name || formatContact(l.owner_contact)}</td>
                        <td className="px-4 py-3 text-gray-500">{l.approver_name || formatContact(l.approver_contact)}</td>
                        <td className="px-4 py-3 text-gray-500">{l.expiry_date ? String(l.expiry_date).slice(0, 10) : '—'}</td>
                        <td className="px-4 py-3">
                          {l.approval_status === 'approved' && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Approved</span>}
                          {l.approval_status === 'pending' && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Pending</span>}
                          {l.approval_status === 'rejected' && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Rejected</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{l.asset_count || 0} assets • {l.service_count || 0} services</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button className="action-icon-btn" onClick={() => openEditLicense(l)} title="Edit"><Pencil size={14} /></button>
                            <button className="action-text-btn" onClick={() => requestApproval(l.id)} title="Request approval email">Send approval</button>
                            <button className="action-icon-btn action-icon-btn-success" onClick={() => approve(l.id)} title="Approve"><CheckCircle2 size={14} /></button>
                            <button className="action-icon-btn action-icon-btn-warn" onClick={() => reject(l.id)} title="Reject"><XCircle size={14} /></button>
                            <button className="action-icon-btn action-icon-btn-danger" onClick={() => setLicenseDeleteTarget(l)} title="Delete"><Trash2 size={14} /></button>
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
              <button className="btn-primary" onClick={openCreateSupplier}><Plus size={15} />New Supplier</button>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>{['First name', 'Last name', 'Company', 'Email', 'Phone', 'Mobile', 'VAT', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {suppliers.map(s => (
                      <tr key={s.id}>
                        <td className="px-4 py-3">{s.first_name}</td>
                        <td className="px-4 py-3">{s.last_name}</td>
                        <td className="px-4 py-3">{s.company}</td>
                        <td className="px-4 py-3 text-gray-500">{s.email}</td>
                        <td className="px-4 py-3 text-gray-500">{s.phone || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{s.mobile || '—'}</td>
                        <td className="px-4 py-3 text-gray-500">{s.vat_number || '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button className="action-icon-btn" onClick={() => openEditSupplier(s)} title="Edit"><Pencil size={14} /></button>
                            <button className="action-icon-btn action-icon-btn-danger" onClick={() => setSupplierDeleteTarget(s)} title="Delete"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {suppliers.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-500">No suppliers</td></tr>}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name *</label>
                <input className="input" required value={licenseForm.name} onChange={e => setLicenseForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Supplier</label>
                <select className="input" value={licenseForm.supplier_id} onChange={e => setLicenseForm(f => ({ ...f, supplier_id: e.target.value }))}>
                  <option value="">— Select supplier —</option>
                  {supplierOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
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
                value={licenseForm.owner_contact}
                loading={ownerSearching}
                results={ownerResults}
                onSearch={searchOwnerLocalOrLdap}
                onSelect={(item) => setLicenseForm(f => ({ ...f, owner_contact: item }))}
                onClear={() => setLicenseForm(f => ({ ...f, owner_contact: null }))}
              />
              <ContactPicker
                label="Maintainer (Local, LDAP or Suppliers)"
                placeholder="Search local/LDAP user or supplier..."
                value={licenseForm.maintainer_contact}
                loading={maintSearching}
                results={maintResults}
                onSearch={(q) => searchMaintOrApprover(q, setMaintSearching, setMaintResults)}
                onSelect={(item) => setLicenseForm(f => ({ ...f, maintainer_contact: item }))}
                onClear={() => setLicenseForm(f => ({ ...f, maintainer_contact: null }))}
              />
              <ContactPicker
                label="Approver (Local, LDAP or Suppliers)"
                placeholder="Search local/LDAP user or supplier..."
                value={licenseForm.approver_contact}
                loading={approverSearching}
                results={approverResults}
                onSearch={(q) => searchMaintOrApprover(q, setApproverSearching, setApproverResults)}
                onSelect={(item) => setLicenseForm(f => ({ ...f, approver_contact: item }))}
                onClear={() => setLicenseForm(f => ({ ...f, approver_contact: null }))}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Expiry date</label>
                <input className="input" type="date" value={licenseForm.expiry_date} onChange={e => setLicenseForm(f => ({ ...f, expiry_date: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Renewal date</label>
                <input className="input" type="date" value={licenseForm.renewal_date} onChange={e => setLicenseForm(f => ({ ...f, renewal_date: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Reminder days</label>
                <input className="input" type="number" min="1" max="365" value={licenseForm.reminder_days} onChange={e => setLicenseForm(f => ({ ...f, reminder_days: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Approval status</label>
                <select className="input" value={licenseForm.approval_status} onChange={e => setLicenseForm(f => ({ ...f, approval_status: e.target.value }))}>
                  <option value="pending">pending</option>
                  <option value="approved">approved</option>
                  <option value="rejected">rejected</option>
                </select>
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
            <SupplierForm value={supplierForm} onChange={setSupplierForm} />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowSupplierForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </Modal>
      )}

      {licenseDeleteTarget && (
        <ConfirmDialog
          title="Delete license"
          message={`Delete "${licenseDeleteTarget.name}"?`}
          danger
          confirmLabel="Delete"
          onConfirm={removeLicense}
          onCancel={() => setLicenseDeleteTarget(null)}
        />
      )}

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
    </Layout>
  )
}

function FileIconFallback(props) {
  return <UserRound {...props} />
}
