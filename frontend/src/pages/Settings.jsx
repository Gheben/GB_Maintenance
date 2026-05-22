import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { Modal, ConfirmDialog } from '../components/Modal'
import { settingsApi, apikeysApi, maintenanceTypesApi, assetCategoriesApi, notificationsApi, uploadsApi } from '../api'
import { toast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { format } from 'date-fns'
import { Copy, ExternalLink, Shield, Save, CheckCircle, AlertCircle, Server, XCircle, Plus, Trash2, Eye, EyeOff, Send, Clock, RefreshCw, Pencil, GripVertical, Mail, Network, KeyRound, Tag, Cog, Bell, ChevronDown, ChevronRight, Upload } from 'lucide-react'


function Section({ title, children }) {
  return (
    <div className="card p-5 sm:p-6 space-y-4">
      <h2 className="font-semibold text-base border-b border-gray-100 dark:border-gray-700 pb-2">{title}</h2>
      {children}
    </div>
  )
}

export default function Settings() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'superadmin'
  const [tab, setTab] = useState('smtp')
  const [smtp, setSmtp] = useState({ host: '', port: 587, secure: false, user: '', pass: '', from: '' })
  const [ldap, setLdap] = useState({
    enabled: false,
    url: '',
    domain: '',
    base_dn: '',
    bind_username: '',
    bind_password: '',
    skip_cert_verify: false,
    user_filter: '(sAMAccountName={{username}})',
    ad_mode: true,
  })
  const [ldapSavedHasPassword, setLdapSavedHasPassword] = useState(false)
  const [ldapTesting, setLdapTesting] = useState(false)
  const [ldapTestResult, setLdapTestResult] = useState(null)
  const [saml, setSaml] = useState({
    enabled: false, auto_redirect: false, require_group_match: false,
    sp_base_url: window.location.origin, sp_entity_id: '',
    idp_sso_url: '', idp_slo_url: '', idp_cert: '',
    sp_private_key: '', sp_cert: '',
    username_attribute: '', display_name_attribute: 'displayName',
    email_attribute: 'email', default_role: 'viewer',
  })
  const [general, setGeneral] = useState({
    app_name: 'GB Maintenance',
    app_url: '',
    app_brand_image_url: '',
    audit_log_retention_days: 365,
    audit_log_auto_purge: true,
  })
  const [systemGeneralOpen, setSystemGeneralOpen] = useState(false)
  const [systemAuditOpen, setSystemAuditOpen] = useState(false)
  const [systemDateTimeOpen, setSystemDateTimeOpen] = useState(false)
  const [systemDemoOpen, setSystemDemoOpen] = useState(false)
  const [demoStatus, setDemoStatus] = useState(null)
  const [demoLoading, setDemoLoading] = useState(false)
  const [demoWorking, setDemoWorking] = useState(false)
  const [showDemoClearConfirm, setShowDemoClearConfirm] = useState(false)
  const [appBrandUploading, setAppBrandUploading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showSmtpPass, setShowSmtpPass] = useState(false)
  const [smtpResult, setSmtpResult] = useState(null)
  const [testEmail, setTestEmail] = useState('')
  const [testing, setTesting] = useState(false)
  const [samlDirty, setSamlDirty] = useState(false)
  const [samlSaving, setSamlSaving] = useState(false)
  const [samlResult, setSamlResult] = useState(null)

  // NTP / Timezone
  const [ntp, setNtp] = useState({ ntp_server: 'pool.ntp.org', timezone: 'Europe/Rome', note: '' })
  const [ntpDirty, setNtpDirty] = useState(false)
  const [ntpSaving, setNtpSaving] = useState(false)
  const [ntpSyncing, setNtpSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)

  // API Keys state
  const [keys, setKeys] = useState([])
  const [showCreateKey, setShowCreateKey] = useState(false)
  const [newKey, setNewKey] = useState(null)
  const [deleteTargetKey, setDeleteTargetKey] = useState(null)
  const [keyForm, setKeyForm] = useState({ name: '', expires_at: '' })

  // Maintenance Types state
  const [mTypes, setMTypes] = useState([])

  // Email templates state
  const [emailTemplates, setEmailTemplates] = useState([])
  const [editingTpl, setEditingTpl] = useState(null) // { id, subject_template, body_html_template, is_active }
  const [expandedTplGroups, setExpandedTplGroups] = useState({})

  // Asset Categories state
  const [aCats, setACats] = useState([])
  const [showCreateCat, setShowCreateCat] = useState(false)
  const [deleteTargetCat, setDeleteTargetCat] = useState(null)
  const [editingCatId, setEditingCatId] = useState(null)
  const [editingCatLabel, setEditingCatLabel] = useState('')
  const [editingCatColor, setEditingCatColor] = useState('#6366f1')
  const [catForm, setCatForm] = useState({ label: '', color: '#6366f1' })
  const [catError, setCatError] = useState('')
  const [showCreateType, setShowCreateType] = useState(false)
  const [deleteTargetType, setDeleteTargetType] = useState(null)
  const [editingTypeId, setEditingTypeId] = useState(null)
  const [editingTypeLabel, setEditingTypeLabel] = useState('')
  const [editingTypeColor, setEditingTypeColor] = useState('#6366f1')
  const [typeForm, setTypeForm] = useState({ label: '', slug: '', color: '#6366f1' })
  const [typeError, setTypeError] = useState('')

  useEffect(() => {
    settingsApi.getSmtp().then(r => setSmtp(prev => ({ ...prev, ...r.data }))).catch(() => {})
    if (isSuperAdmin) {
      settingsApi.getLdap().then(r => {
        const d = r.data || {}
        setLdapSavedHasPassword(!!(d.bind_password || d.ldap_service_password))
        setLdap({
          enabled: d.enabled || false,
          url: d.url || d.ldap_server || '',
          domain: d.domain || d.ldap_domain || '',
          base_dn: d.base_dn || d.ldap_base_dn || '',
          bind_username: d.bind_username || d.ldap_service_username || '',
          bind_password: '',
          skip_cert_verify: d.skip_cert_verify || false,
          user_filter: d.user_filter || '(sAMAccountName={{username}})',
          ad_mode: d.ad_mode !== false,
        })
      }).catch(() => {})
      settingsApi.getSaml().then(r => setSaml(prev => ({ ...prev, ...r.data }))).catch(() => {})
      settingsApi.getGeneral().then(r => setGeneral(r.data)).catch(() => {})
    }
    settingsApi.getNtp().then(r => setNtp(r.data)).catch(() => {})
  }, [isSuperAdmin])

  useEffect(() => {
    if (!isSuperAdmin && ['ldap', 'saml'].includes(tab)) {
      setTab('smtp')
    }
  }, [isSuperAdmin, tab])

  useEffect(() => {
    if (tab === 'apikeys') apikeysApi.list().then(r => setKeys(r.data)).catch(() => {})
    if (tab === 'emailtpl') notificationsApi.templates().then(r => setEmailTemplates(r.data)).catch(() => {})
    if (tab === 'general' && isSuperAdmin) {
      setDemoLoading(true)
      settingsApi.getDemoStatus()
        .then(r => setDemoStatus(r.data))
        .catch(() => setDemoStatus(null))
        .finally(() => setDemoLoading(false))
    }
  }, [tab, isSuperAdmin])

  const saveSmtp = async (e) => {
    e.preventDefault(); setLoading(true); setSmtpResult(null)
    try {
      const payload = { ...smtp, pass: smtp.pass === '********' ? '' : smtp.pass }
      await settingsApi.saveSmtp(payload)
      setSmtpResult({ success: true, message: 'SMTP settings saved.' })
    } catch (err) {
      const errs = err.response?.data?.errors
      const msg = errs ? errs.map(e => `${e.path}: ${e.msg}`).join(' • ') : (err.response?.data?.error || 'Save error.')
      setSmtpResult({ success: false, message: msg })
    }
    finally { setLoading(false) }
  }

  const handleTestSmtp = async () => {
    if (!testEmail) return
    setTesting(true); setSmtpResult(null)
    try {
      const res = await settingsApi.testSmtp({ to: testEmail })
      setSmtpResult({ success: true, message: res.data?.message || `SMTP test successful for ${testEmail}.` })
    }
    catch (err) {
      const errs = err.response?.data?.errors
      const msg = errs
        ? errs.map(e => `${e.path}: ${e.msg}`).join(' • ')
        : (err.response?.data?.error || 'Error sending test email.')
      setSmtpResult({ success: false, message: msg })
    }
    finally { setTesting(false) }
  }

  const saveLdap = async (e) => {
    e.preventDefault(); setLoading(true)
    try {
      await settingsApi.saveLdap(ldap)
      toast.success('LDAP saved')
      if (ldap.bind_password) setLdapSavedHasPassword(true)
    }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
    finally { setLoading(false) }
  }

  const testLdap = async () => {
    setLdapTesting(true); setLdapTestResult(null)
    try {
      const res = await settingsApi.testLdap(ldap)
      setLdapTestResult({ ok: true, message: res.data?.message || 'Connection successful' })
    } catch (err) {
      setLdapTestResult({ ok: false, message: err.response?.data?.error || 'Test failed' })
    } finally {
      setLdapTesting(false)
    }
  }

  function computeBaseDn(domain) {
    if (!domain) return ''
    return domain.split('.').map(p => `DC=${p}`).join(',')
  }

  const saveGeneral = async (e) => {
    e.preventDefault()
    try {
      await settingsApi.saveGeneral(general)
      window.dispatchEvent(new CustomEvent('app-branding-updated', { detail: general }))
      toast.success('Settings saved')
    }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const uploadAppBrandImage = async (file) => {
    if (!file) return
    try {
      setAppBrandUploading(true)
      const r = await uploadsApi.uploadAppBrandImage(file)
      setGeneral(f => ({ ...f, app_brand_image_url: r.data?.url || '' }))
      toast.success('Brand image uploaded')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload error')
    } finally {
      setAppBrandUploading(false)
    }
  }

  const saveNtp = async (e) => {
    e.preventDefault()
    setNtpSaving(true)
    try { await settingsApi.saveNtp(ntp); setNtpDirty(false); toast.success('NTP configuration saved') }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
    finally { setNtpSaving(false) }
  }

  const handleQueryNtp = async () => {
    setNtpSyncing(true); setSyncResult(null)
    try {
      const r = await settingsApi.queryNtp(ntp.ntp_server)
      const d = r.data
      const offsetSec = d.offset_ms != null ? (d.offset_ms / 1000).toFixed(2) : null
      const sign = d.offset_ms >= 0 ? '+' : ''
      setSyncResult({ success: true, message: `NTP OK — server: ${d.ntp_server || ntp.ntp_server}${d.ntp_time ? ' — time: ' + new Date(d.ntp_time).toLocaleString() : ''}${offsetSec != null ? ' — offset: ' + sign + offsetSec + 's' : ''}` })
    } catch (err) {
      setSyncResult({ success: false, message: err.response?.data?.error || 'NTP query failed.' })
    } finally { setNtpSyncing(false) }
  }

  const refreshDemoStatus = async () => {
    if (!isSuperAdmin) return
    setDemoLoading(true)
    try {
      const r = await settingsApi.getDemoStatus()
      setDemoStatus(r.data)
    } catch {
      setDemoStatus(null)
    } finally {
      setDemoLoading(false)
    }
  }

  const handleCreateDemoData = async () => {
    setDemoWorking(true)
    try {
      const r = await settingsApi.createDemoData()
      toast.success(r.data?.message || 'Demo data created')
      await refreshDemoStatus()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Unable to create demo data')
    } finally {
      setDemoWorking(false)
    }
  }

  const handleClearDemoData = async () => {
    setDemoWorking(true)
    try {
      const r = await settingsApi.clearDemoData()
      toast.success(r.data?.message || 'Demo data removed')
      await refreshDemoStatus()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Unable to remove demo data')
    } finally {
      setDemoWorking(false)
      setShowDemoClearConfirm(false)
    }
  }

  const saveSaml = async (e) => {
    e.preventDefault(); setSamlSaving(true); setSamlResult(null)
    try { await settingsApi.saveSaml(saml); setSamlDirty(false); setSamlResult({ success: true, message: 'SAML configuration saved.' }) }
    catch (err) { setSamlResult({ success: false, message: err.response?.data?.error || 'Save error.' }) }
    finally { setSamlSaving(false) }
  }

  const handleCreateKey = async (e) => {
    e.preventDefault()
    try {
      const payload = { name: keyForm.name }
      if (keyForm.expires_at) payload.expires_at = keyForm.expires_at
      const res = await apikeysApi.create(payload)
      setNewKey(res.data.key)
      setShowCreateKey(false)
      apikeysApi.list().then(r => setKeys(r.data))
    } catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const handleDeleteKey = async () => {
    try { await apikeysApi.delete(deleteTargetKey.id); toast.success('Key deleted'); setDeleteTargetKey(null); apikeysApi.list().then(r => setKeys(r.data)) }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const handleCreateType = async (e) => {
    e.preventDefault()
    setTypeError('')
    if (!typeForm.label.trim()) { setTypeError('Label is required'); return }
    try {
      await maintenanceTypesApi.create(typeForm)
      setShowCreateType(false)
      setTypeForm({ label: '', slug: '', color: '#6366f1' })
      maintenanceTypesApi.list().then(r => setMTypes(r.data))
    } catch (err) { setTypeError(err.response?.data?.error || 'Error') }
  }

  const handleSaveTypeLabel = async (id) => {
    if (!editingTypeLabel.trim()) return
    try {
      await maintenanceTypesApi.update(id, { label: editingTypeLabel, color: editingTypeColor })
      setEditingTypeId(null)
      maintenanceTypesApi.list().then(r => setMTypes(r.data))
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const handleDeleteType = async () => {
    try {
      await maintenanceTypesApi.delete(deleteTargetType.id)
      toast.success('Type deleted')
      setDeleteTargetType(null)
      maintenanceTypesApi.list().then(r => setMTypes(r.data))
    } catch (err) { toast.error(err.response?.data?.error || 'Error'); setDeleteTargetType(null) }
  }

  const handleCreateCat = async (e) => {
    e.preventDefault(); setCatError('')
    if (!catForm.label.trim()) return setCatError('Label is required')
    try {
      await assetCategoriesApi.create(catForm)
      toast.success('Category created')
      setShowCreateCat(false); setCatForm({ label: '', color: '#6366f1' })
      assetCategoriesApi.list().then(r => setACats(r.data))
    } catch (err) { setCatError(err.response?.data?.error || 'Error') }
  }

  const handleSaveCat = async (id) => {
    try {
      await assetCategoriesApi.update(id, { label: editingCatLabel, color: editingCatColor })
      setEditingCatId(null)
      assetCategoriesApi.list().then(r => setACats(r.data))
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const handleDeleteCat = async () => {
    try {
      await assetCategoriesApi.delete(deleteTargetCat.id)
      toast.success('Category deleted')
      setDeleteTargetCat(null)
      assetCategoriesApi.list().then(r => setACats(r.data))
    } catch (err) { toast.error(err.response?.data?.error || 'Error'); setDeleteTargetCat(null) }
  }

  const spBaseUrl = saml.sp_base_url || window.location.origin

  const TYPE_COLORS = [
    '#3b82f6','#6366f1','#8b5cf6','#ec4899',
    '#ef4444','#f97316','#f59e0b','#eab308',
    '#10b981','#14b8a6','#06b6d4','#6b7280',
  ]

  const TABS = [
    { id: 'smtp',     label: 'SMTP & Email',      icon: Mail },
    { id: 'emailtpl', label: 'Email Templates',   icon: Bell },
    ...(isSuperAdmin ? [{ id: 'ldap', label: 'LDAP / AD', icon: Network }] : []),
    ...(isSuperAdmin ? [{ id: 'saml', label: 'SAML / SSO', icon: Shield }] : []),
    { id: 'apikeys',  label: 'API Keys',           icon: KeyRound },
    { id: 'general',  label: 'System',             icon: Cog },
  ]

  return (
    <Layout title="Settings">
      <div className="space-y-4">
        <div className="py-2 -mx-4 sm:mx-0 px-4 sm:px-0 border-b border-gray-200 dark:border-gray-700">
          <nav className="flex flex-wrap gap-1.5">
            {TABS.map(t => {
              const Icon = t.icon
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-full transition-colors ${
                    tab === t.id ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}>
                  <Icon size={14} />{t.label}
                </button>
              )
            })}
          </nav>
        </div>

        {tab === 'smtp' && (
          <div className="space-y-6">
            <div className="card p-5 sm:p-6 space-y-5">
              <h2 className="font-semibold text-base border-b border-gray-100 dark:border-gray-700 pb-2">SMTP Configuration</h2>
              <p className="text-sm text-gray-500">Used to send email notifications when maintenance events occur.</p>
              <form onSubmit={saveSmtp} className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium mb-1">SMTP Server</label>
                    <input className="input" placeholder="smtp.company.com" value={smtp.host}
                      onChange={e => { setSmtp(f => ({ ...f, host: e.target.value })); setSmtpResult(null) }} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Port</label>
                    <input className="input" type="number" placeholder="587" value={smtp.port ?? ''}
                      onChange={e => { const v = parseInt(e.target.value); setSmtp(f => ({ ...f, port: isNaN(v) ? '' : v })); setSmtpResult(null) }} />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <input type="checkbox" id="smtp-secure" checked={smtp.secure}
                      onChange={e => { setSmtp(f => ({ ...f, secure: e.target.checked })); setSmtpResult(null) }} className="w-4 h-4 accent-brand-600" />
                    <label htmlFor="smtp-secure" className="text-sm text-gray-700">Direct TLS (SSL, port 465) — disable for STARTTLS</label>
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="checkbox" id="smtp-ignoreTls" checked={smtp.ignoreTls || false}
                      onChange={e => { setSmtp(f => ({ ...f, ignoreTls: e.target.checked })); setSmtpResult(null) }} className="w-4 h-4 accent-brand-600" />
                    <label htmlFor="smtp-ignoreTls" className="text-sm text-gray-700">Skip STARTTLS — relay without authentication (e.g. internal port 25)</label>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">SMTP User</label>
                  <input className="input" type="email" placeholder="maintenance@company.com"
                    value={smtp.user} onChange={e => { setSmtp(f => ({ ...f, user: e.target.value })); setSmtpResult(null) }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Password <span className="text-gray-400 font-normal">(leave blank to keep current)</span></label>
                  <div className="relative">
                    <input className="input pr-10" type={showSmtpPass ? 'text' : 'password'}
                      placeholder="••••••••" value={smtp.pass === '********' ? '' : smtp.pass}
                      onChange={e => { setSmtp(f => ({ ...f, pass: e.target.value })); setSmtpResult(null) }} autoComplete="new-password" />
                    <button type="button" onClick={() => setShowSmtpPass(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      {showSmtpPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Sender (From)</label>
                  <input className="input" placeholder='GB Maintenance <maintenance@company.com>'
                    value={smtp.from} onChange={e => { setSmtp(f => ({ ...f, from: e.target.value })); setSmtpResult(null) }} />
                </div>
                <div className="flex gap-3 pt-1">
                  <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
                    <Save size={15} />{loading ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </form>
            </div>

            <div className="card p-5 sm:p-6 space-y-4">
              <h2 className="font-semibold text-base border-b border-gray-100 dark:border-gray-700 pb-2">Email test</h2>
              <p className="text-sm text-gray-500">Send a test email using the current (already saved) SMTP configuration.</p>
              <div className="flex gap-3">
                <input className="input flex-1" type="email" placeholder="recipient@example.com"
                  value={testEmail} onChange={e => setTestEmail(e.target.value)} />
                <button onClick={handleTestSmtp} disabled={testing || !testEmail}
                  className="btn-primary flex items-center gap-2 whitespace-nowrap disabled:opacity-50">
                  <Send size={15} />{testing ? 'Sending...' : 'Send test'}
                </button>
              </div>
            </div>

            {smtpResult && (
              <div className={`flex items-start gap-3 p-4 rounded-lg border ${smtpResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                {smtpResult.success ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
                <p className="text-sm">{smtpResult.message}</p>
              </div>
            )}
          </div>
        )}

        {tab === 'ldap' && (
          <form onSubmit={saveLdap} className="space-y-4">
            {/* Enable */}
            <div className="card p-5">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={ldap.enabled}
                  onChange={e => setLdap(f => ({ ...f, enabled: e.target.checked }))}
                  className="w-4 h-4 accent-brand-600" />
              <span className="font-semibold text-gray-800 dark:text-gray-100">Enable LDAP / Active Directory authentication</span>
              </label>
              {ldap.enabled && (
                <p className="mt-2 text-sm text-cyan-700 dark:text-cyan-300">LDAP enabled — users can log in with domain credentials.</p>
              )}
            </div>

            <div className={`space-y-4 transition-opacity duration-200 ${!ldap.enabled ? 'opacity-40 pointer-events-none' : ''}`}>
              {/* Connessione */}
              <div className="card p-5 space-y-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">LDAP Connection</h3>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">LDAP Server</label>
                  <input className="input" value={ldap.url}
                    onChange={e => setLdap(f => ({ ...f, url: e.target.value }))}
                    placeholder="ldaps://dc.azienda.local  oppure  ldap://192.168.1.10" />
                  <p className="mt-1 text-xs text-gray-400">Use <code>ldaps://</code> for LDAP over TLS (port 636), <code>ldap://</code> for unencrypted (port 389).</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Active Directory Domain</label>
                  <input className="input" value={ldap.domain}
                    onChange={e => setLdap(f => ({ ...f, domain: e.target.value }))}
                    placeholder="company.local" />
                  <p className="mt-1 text-xs text-gray-400">Used to bind the service account as <code>username@domain</code>.</p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-gray-500">Base DN</label>
                    {ldap.domain && (
                      <button type="button"
                        onClick={() => setLdap(f => ({ ...f, base_dn: computeBaseDn(f.domain) }))}
                        className="text-xs text-brand-600 hover:underline">
                        Derive from domain
                      </button>
                    )}
                  </div>
                  <input className="input font-mono text-xs" value={ldap.base_dn}
                    onChange={e => setLdap(f => ({ ...f, base_dn: e.target.value }))}
                    placeholder="DC=azienda,DC=local" />
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
                  <input type="checkbox" checked={ldap.skip_cert_verify}
                    onChange={e => setLdap(f => ({ ...f, skip_cert_verify: e.target.checked }))}
                    className="accent-brand-600" />
                  Ignore TLS certificate verification
                </label>
              </div>

              {/* Service Account */}
              <div className="card p-5 space-y-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Service account</h3>
                <p className="text-xs text-gray-400">Account used to search users in AD. Authenticates as <code>username@domain</code>.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
                    <input className="input" value={ldap.bind_username}
                      onChange={e => setLdap(f => ({ ...f, bind_username: e.target.value }))}
                      placeholder="ServiceMaintenance" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Password</label>
                    <input type="password" className="input" value={ldap.bind_password}
                      onChange={e => setLdap(f => ({ ...f, bind_password: e.target.value }))}
                      placeholder={ldapSavedHasPassword ? '••••••••  (leave empty to keep current)' : 'Service account password'} />
                  </div>
                </div>
              </div>

              {/* Ricerca utenti */}
              <div className="card p-5 space-y-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">User search</h3>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">User filter</label>
                  <input className="input font-mono text-xs" value={ldap.user_filter}
                    onChange={e => setLdap(f => ({ ...f, user_filter: e.target.value }))}
                    placeholder="(sAMAccountName={{username}})" />
                  <p className="mt-1 text-xs text-gray-400">{'Use {{username}} as placeholder for the username entered at login.'}</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
                  <input type="checkbox" checked={ldap.ad_mode}
                    onChange={e => setLdap(f => ({ ...f, ad_mode: e.target.checked }))}
                    className="accent-brand-600" />
                  <span>
                    Active Directory mode
                    <span className="text-gray-400 text-xs ml-1 font-normal">(nested groups via LDAP_MATCHING_RULE_IN_CHAIN)</span>
                  </span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-4 flex-wrap">
                <button type="button" onClick={testLdap} disabled={ldapTesting || !ldap.url}
                  className="btn-secondary flex items-center gap-2 disabled:opacity-50">
                  <Server size={15} />{ldapTesting ? 'Testing...' : 'Test connection'}
                </button>
                {ldapTestResult && (
                  <span className={`flex items-center gap-1.5 text-sm font-medium ${ldapTestResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                    {ldapTestResult.ok ? <CheckCircle size={15} /> : <XCircle size={15} />}
                    {ldapTestResult.message}
                  </span>
                )}
                <div className="flex-1" />
                <button type="submit" className="btn-primary flex items-center gap-2" disabled={loading}>
                  <Save size={14} />{loading ? 'Saving...' : 'Save LDAP settings'}
                </button>
              </div>
            </div>
          </form>
        )}

        {tab === 'saml' && (
          <Section title="SAML 2.0 / SSO Authentication">
            <form onSubmit={saveSaml} className="space-y-5">
              <p className="text-sm text-gray-500">
                Enable login through a SAML Identity Provider (e.g. NetScaler, ADFS, Azure AD).
                The Service Provider is configured as SP-initiated (the browser is redirected to the IdP and back).
              </p>

              {/* Enable */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" id="saml-enabled" checked={saml.enabled}
                  onChange={e => { setSaml(s => ({ ...s, enabled: e.target.checked, auto_redirect: e.target.checked ? s.auto_redirect : false })); setSamlDirty(true) }}
                  className="w-4 h-4 accent-brand-600" />
                <span className="text-sm font-medium">Enable SAML 2.0 authentication</span>
              </label>

              {/* Auto-redirect */}
              {saml.enabled && (
                <label className="flex items-start gap-3 cursor-pointer bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg px-4 py-3">
                  <input type="checkbox" checked={!!saml.auto_redirect}
                    onChange={e => { setSaml(s => ({ ...s, auto_redirect: e.target.checked })); setSamlDirty(true) }}
                    className="w-4 h-4 accent-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-sm font-medium">Automatic SSO redirect (auto-redirect)</span>
                    <p className="text-xs text-gray-500 mt-0.5">
                      When enabled, the browser is redirected directly to the Identity Provider (NetScaler)
                      without showing the local login form. Local login remains accessible at{' '}
                      <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">/login?local</code>.
                    </p>
                  </div>
                </label>
              )}

              {/* LDAP group mapping integration note */}
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-4 space-y-2">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">Integration with LDAP group mapping</p>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  If group mappings are configured in <strong>User management → LDAP / Active Directory</strong>,
                  the system applies them automatically to SAML users too: at each login the user&rsquo;s AD groups
                  are retrieved and the role is assigned based on the configured mapping.
                  Only if no group matches is the <em>Default role</em> configured below used.
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  <strong>Tip:</strong> ask the IdP admin to include the{' '}
                  <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">memberOf</code> attribute in the SAML assertion —
                  this reduces traffic to the Domain Controller and ensures group resolution
                  even if the DC is temporarily unreachable.
                </p>
              </div>

              {/* Dati da comunicare all'IdP */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4 space-y-3">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">Data to provide to the IdP administrator</p>
                <div className="space-y-2">
                  <div>
                    <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">ACS URL (Assertion Consumer Service):</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <code className="flex-1 text-xs bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded px-2 py-1 break-all">{spBaseUrl}/api/auth/saml/acs</code>
                      <button type="button" onClick={() => { navigator.clipboard.writeText(`${spBaseUrl}/api/auth/saml/acs`); toast.success('Copied') }}
                        className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded" title="Copia"><Copy size={13} /></button>
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">SP Entity ID:</span>
                    <code className="block text-xs bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded px-2 py-1 mt-0.5 break-all">
                      {saml.sp_entity_id || `${spBaseUrl}/api/auth/saml/metadata`}
                    </code>
                  </div>
                  <div>
                    <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">SP Metadata XML:</span>
                    <a href="/api/auth/saml/metadata" target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300 underline mt-0.5 hover:text-blue-900">
                      <ExternalLink size={11} /> /api/auth/saml/metadata
                    </a>
                  </div>
                  <div>
                    <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">SLO URL (Single Logout):</span>
                    <code className="block text-xs bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded px-2 py-1 mt-0.5 break-all">{spBaseUrl}/api/auth/saml/slo</code>
                  </div>
                  <div>
                    <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Binding:</span>
                    <span className="text-xs text-blue-800 dark:text-blue-200 ml-1">HTTP-POST</span>
                  </div>
                </div>
              </div>

              {/* SP Config */}
              <div>
                <label className="block text-xs font-medium mb-1">SP Base URL <span className="text-gray-400 font-normal">(public URL of this application)</span></label>
                <input className="input" placeholder="https://maintenance.company.com"
                  value={saml.sp_base_url}
                  onChange={e => { setSaml(s => ({ ...s, sp_base_url: e.target.value })); setSamlDirty(true) }} />
                <p className="text-xs text-gray-400 mt-1">Must match the URL users use to access the application.</p>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">SP Entity ID <span className="text-gray-400 font-normal">(leave empty to use default)</span></label>
                <input className="input" placeholder={`${spBaseUrl}/api/auth/saml/metadata`}
                  value={saml.sp_entity_id}
                  onChange={e => { setSaml(s => ({ ...s, sp_entity_id: e.target.value })); setSamlDirty(true) }} />
              </div>

              {/* IdP Config */}
              <div>
                <label className="block text-xs font-medium mb-1">IdP SSO URL <span className="text-gray-400 font-normal">(Identity Provider login URL)</span></label>
                <input className="input" placeholder="https://idp.company.com/saml/login"
                  value={saml.idp_sso_url}
                  onChange={e => { setSaml(s => ({ ...s, idp_sso_url: e.target.value })); setSamlDirty(true) }} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">IdP SLO URL <span className="text-gray-400 font-normal">(Single Logout — optional)</span></label>
                <input className="input" placeholder="https://idp.company.com/logout"
                  value={saml.idp_slo_url}
                  onChange={e => { setSaml(s => ({ ...s, idp_slo_url: e.target.value })); setSamlDirty(true) }} />
                  <p className="text-xs text-gray-400 mt-1">If configured, logging out of this app will also terminate the session on the Identity Provider.</p>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">IdP Certificate (X.509 PEM)</label>
                <textarea className="input font-mono text-xs" rows={6}
                  placeholder={'-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----'}
                  value={saml.idp_cert}
                  onChange={e => { setSaml(s => ({ ...s, idp_cert: e.target.value })); setSamlDirty(true) }} />
                  <p className="text-xs text-gray-400 mt-1">Paste the X.509 certificate provided by the NetScaler administrator. Accepted with or without PEM header.</p>
              </div>

              {/* Attribute mapping */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Username attribute <span className="text-gray-400 font-normal">(empty = NameID)</span></label>
                  <input className="input text-xs" placeholder="NameID (default)"
                    value={saml.username_attribute}
                    onChange={e => { setSaml(s => ({ ...s, username_attribute: e.target.value })); setSamlDirty(true) }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Display name attribute</label>
                  <input className="input text-xs" placeholder="displayName"
                    value={saml.display_name_attribute}
                    onChange={e => { setSaml(s => ({ ...s, display_name_attribute: e.target.value })); setSamlDirty(true) }} />
                </div>
              </div>

              {/* Default role */}
              <div>
                <label className="block text-xs font-medium mb-1">Default role for new SAML users</label>
                <select className="input" value={saml.default_role}
                  onChange={e => { setSaml(s => ({ ...s, default_role: e.target.value })); setSamlDirty(true) }}>
                  {['admin','change_manager','operator','viewer','subscriber'].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                  <p className="text-xs text-gray-400 mt-1">The role can be changed individually in "User management" after first login.</p>
              </div>

              {/* Require group match */}
              <label className="flex items-start gap-3 cursor-pointer bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg px-4 py-3">
                <input type="checkbox" checked={!!saml.require_group_match}
                  onChange={e => { setSaml(s => ({ ...s, require_group_match: e.target.checked })); setSamlDirty(true) }}
                  className="w-4 h-4 accent-red-600 mt-0.5 shrink-0" />
                <div>
                    <span className="text-sm font-medium">Deny access if no LDAP group matches</span>
                    <p className="text-xs text-gray-500 mt-0.5">
                      When enabled, users authenticated by the IdP but not belonging to any mapped LDAP group
                      are <strong>blocked</strong>. When disabled (default) they receive the <em>Default role</em> configured above.
                  </p>
                </div>
              </label>

              <div className="flex items-center gap-3 pt-1">
                <button type="submit" className="btn-primary flex items-center gap-2" disabled={samlSaving}>
                  <Save size={14} />{samlSaving ? 'Saving...' : 'Save SAML configuration'}
                </button>
              </div>

              {samlResult && (
                <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${samlResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                  {samlResult.success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                  {samlResult.message}
                </div>
              )}
            </form>
          </Section>
        )}

        {tab === 'types' && (
          <div className="space-y-4">
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-base text-gray-700">Maintenance Types</h3>
                  <p className="text-sm text-gray-500 mt-0.5">Configure the types available when creating a maintenance window. The slug is permanent; only the label can be renamed.</p>
                </div>
                <button className="btn-primary" onClick={() => { setTypeForm({ label: '', slug: '', color: '#6366f1' }); setTypeError(''); setShowCreateType(true) }}><Plus size={15} />New Type</button>
              </div>

              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {mTypes.map(t => (
                  <div key={t.id} className="flex items-center gap-3 py-3">
                    <GripVertical size={14} className="text-gray-300 shrink-0" />
                    <div className="w-4 h-4 rounded-full shrink-0 border border-white shadow-sm" style={{ backgroundColor: t.color || '#6366f1' }} />
                    <span className="font-mono text-xs text-gray-400 w-32 shrink-0">{t.slug}</span>
                    {editingTypeId === t.id ? (
                      <div className="flex items-center gap-2 flex-1 flex-wrap">
                        <input
                          className="input flex-1 py-1 text-sm min-w-[120px]"
                          value={editingTypeLabel}
                          onChange={e => setEditingTypeLabel(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveTypeLabel(t.id); if (e.key === 'Escape') setEditingTypeId(null) }}
                          autoFocus
                        />
                        <div className="flex gap-1 flex-wrap items-center">
                          {['#3b82f6','#6366f1','#8b5cf6','#ec4899','#ef4444','#f97316','#f59e0b','#eab308','#10b981','#14b8a6','#06b6d4','#6b7280'].map(c => (
                            <button key={c} type="button"
                              onClick={() => setEditingTypeColor(c)}
                              className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${editingTypeColor === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                              style={{ backgroundColor: c }}
                              title={c}
                            />
                          ))}
                          <input type="color" value={editingTypeColor}
                            onChange={e => setEditingTypeColor(e.target.value)}
                            className="w-6 h-6 rounded cursor-pointer border border-gray-300 p-0"
                            title="Custom color" />
                        </div>
                        <button className="btn-primary py-1 px-3 text-sm" onClick={() => handleSaveTypeLabel(t.id)}><Save size={13} />Save</button>
                        <button className="btn-secondary py-1 px-3 text-sm" onClick={() => setEditingTypeId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <span className="flex-1 text-sm font-medium">{t.label}</span>
                    )}
                    {editingTypeId !== t.id && (
                      <div className="flex gap-1 shrink-0">
                        <button className="action-icon-btn" onClick={() => { setEditingTypeId(t.id); setEditingTypeLabel(t.label); setEditingTypeColor(t.color || '#6366f1') }}><Pencil size={13} /></button>
                        <button className="action-icon-btn action-icon-btn-danger" onClick={() => setDeleteTargetType(t)}><Trash2 size={13} /></button>
                      </div>
                    )}
                  </div>
                ))}
                {mTypes.length === 0 && <p className="text-center text-gray-400 py-8 text-sm">No types configured</p>}
              </div>
            </div>
          </div>
        )}

        {tab === 'apikeys' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => setShowCreateKey(true)}><Plus size={15} />New API Key</button>
            </div>
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-[500px] w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>{['Name','Prefix','Expires','Last used','Actions'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {keys.map(k => (
                      <tr key={k.id}>
                        <td className="px-4 py-3">{k.name}</td>
                        <td className="px-4 py-3 font-mono text-xs">{k.key_prefix}...</td>
                        <td className="px-4 py-3 text-gray-500">{k.expires_at ? format(new Date(k.expires_at), 'MM/dd/yyyy') : '∞'}</td>
                        <td className="px-4 py-3 text-gray-500">{k.last_used_at ? format(new Date(k.last_used_at), 'MM/dd HH:mm') : '—'}</td>
                        <td className="px-4 py-3">
                          <button className="p-1 text-red-500 hover:bg-red-50 rounded" onClick={() => setDeleteTargetKey(k)}><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                    {keys.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-gray-500">No API keys</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'emailtpl' && (() => {
          const TPL_VARS = {
            maintenance_scheduled: [
              { key: 'title', desc: 'Maintenance title' },
              { key: 'type', desc: 'Type (planned, emergency…)' },
              { key: 'impact_level', desc: 'Impact level (critical, high…)' },
              { key: 'scheduled_start', desc: 'Scheduled start date/time' },
              { key: 'scheduled_end', desc: 'Scheduled end date/time' },
              { key: 'description', desc: 'Description' },
              { key: 'id', desc: 'Maintenance ID (UUID)' },
              { key: 'app_url', desc: 'Application base URL' },
            ],
            maintenance_reminder: [
              { key: 'title', desc: 'Maintenance title' },
              { key: 'time_before', desc: 'Time remaining (e.g. "2 hours")' },
              { key: 'scheduled_start', desc: 'Scheduled start date/time' },
              { key: 'scheduled_end', desc: 'Scheduled end date/time' },
              { key: 'id', desc: 'Maintenance ID (UUID)' },
              { key: 'app_url', desc: 'Application base URL' },
            ],
            maintenance_started: [
              { key: 'title', desc: 'Maintenance title' },
              { key: 'actual_start', desc: 'Actual start date/time' },
              { key: 'scheduled_end', desc: 'Scheduled end date/time' },
              { key: 'id', desc: 'Maintenance ID (UUID)' },
              { key: 'app_url', desc: 'Application base URL' },
            ],
            maintenance_completed: [
              { key: 'title', desc: 'Maintenance title' },
              { key: 'actual_end', desc: 'Actual end date/time' },
              { key: 'notes', desc: 'Closure notes' },
              { key: 'id', desc: 'Maintenance ID (UUID)' },
              { key: 'app_url', desc: 'Application base URL' },
            ],
            incident_created: [
              { key: 'title', desc: 'Incident title' },
              { key: 'severity', desc: 'Severity (critical, high…)' },
              { key: 'status', desc: 'Current status' },
              { key: 'description', desc: 'Description' },
              { key: 'started_at', desc: 'Start date/time' },
              { key: 'id', desc: 'Incident ID (UUID)' },
              { key: 'app_url', desc: 'Application base URL' },
            ],
            incident_resolved: [
              { key: 'title', desc: 'Incident title' },
              { key: 'resolved_at', desc: 'Resolution date/time' },
              { key: 'id', desc: 'Incident ID (UUID)' },
              { key: 'app_url', desc: 'Application base URL' },
            ],
            license_approval_requested: [
              { key: 'license_name', desc: 'License name' },
              { key: 'supplier_company', desc: 'Supplier company' },
              { key: 'expiry_date', desc: 'License expiry date' },
              { key: 'renewal_date', desc: 'License renewal date' },
              { key: 'approval_url', desc: 'Public approval page URL' },
              { key: 'expires_at', desc: 'Approval link expiration date/time' },
              { key: 'approver_email', desc: 'Recipient approver email' },
              { key: 'license_id', desc: 'License ID (UUID)' },
              { key: 'app_url', desc: 'Application base URL' },
            ],
            license_approved: [
              { key: 'license_name', desc: 'License name' },
              { key: 'supplier_company', desc: 'Supplier company' },
              { key: 'approval_status', desc: 'Current approval status' },
              { key: 'acted_by', desc: 'Who approved the license' },
              { key: 'approved_at', desc: 'Approval date/time' },
              { key: 'license_id', desc: 'License ID (UUID)' },
              { key: 'app_url', desc: 'Application base URL' },
            ],
            license_rejected: [
              { key: 'license_name', desc: 'License name' },
              { key: 'supplier_company', desc: 'Supplier company' },
              { key: 'approval_status', desc: 'Current approval status' },
              { key: 'acted_by', desc: 'Who rejected the license' },
              { key: 'rejected_at', desc: 'Rejection date/time' },
              { key: 'rejection_reason', desc: 'Rejection reason' },
              { key: 'license_id', desc: 'License ID (UUID)' },
              { key: 'app_url', desc: 'Application base URL' },
            ],
          }

          const SAMPLE_VARS = {
            title: 'Database Server Upgrade',
            type: 'planned',
            impact_level: 'high',
            scheduled_start: '12/05/2026 22:00',
            scheduled_end: '13/05/2026 02:00',
            actual_start: '12/05/2026 22:05',
            actual_end: '13/05/2026 01:47',
            description: 'Upgrade del motore PostgreSQL dalla versione 15 alla 16.',
            notes: 'Completato senza anomalie.',
            time_before: '2 ore',
            severity: 'critical',
            status: 'investigating',
            started_at: '12/05/2026 21:00',
            resolved_at: '13/05/2026 00:30',
            license_name: 'Microsoft SQL Server Enterprise',
            supplier_company: 'Contoso Licensing',
            approval_url: `${window.location.origin}/licenses/approval?token=demo-token`,
            expires_at: '16/05/2026 18:00',
            approver_email: 'approver@company.com',
            approval_status: 'pending',
            acted_by: 'system.approver',
            approved_at: '14/05/2026 09:12',
            rejected_at: '14/05/2026 10:21',
            rejection_reason: 'Missing legal addendum',
            license_id: 'yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy',
            id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
            app_url: window.location.origin,
          }

          function renderPreview(html) {
            if (!html) return ''
            return html.replace(/\{\{(\w+)\}\}/g, (_, k) => SAMPLE_VARS[k] ?? `{{${k}}}`)
          }

          const GROUP_ORDER = ['maintenance', 'license', 'incident', 'other']
          const GROUP_LABELS = {
            maintenance: 'Maintenance Templates',
            license: 'License Templates',
            incident: 'Incident Templates',
            other: 'Other Templates',
          }

          const groupedTemplates = emailTemplates.reduce((acc, tpl) => {
            const eventType = String(tpl.event_type || '')
            const prefix = eventType.includes('_') ? eventType.split('_')[0] : eventType
            const group = GROUP_ORDER.includes(prefix) ? prefix : 'other'
            if (!acc[group]) acc[group] = []
            acc[group].push(tpl)
            return acc
          }, {})

          const orderedGroups = GROUP_ORDER
            .map(group => ({ group, templates: groupedTemplates[group] || [] }))
            .filter(g => g.templates.length > 0)

          return (
            <div className="space-y-4">
              <Section title="Email Templates">
                <p className="text-sm text-gray-500">Customize the subject and body of automated emails for each event. Use <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded text-xs">{'{{variable}}'}</code> placeholders — preview uses sample data.</p>
                <div className="space-y-4">
                  {orderedGroups.map(({ group, templates }) => (
                    <div key={group} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        onClick={() => setExpandedTplGroups(prev => ({ ...prev, [group]: !prev[group] }))}
                      >
                        <div className="flex items-center gap-2">
                          {expandedTplGroups[group] ? <ChevronDown size={15} className="text-gray-500" /> : <ChevronRight size={15} className="text-gray-500" />}
                          <h3 className="font-semibold text-sm">{GROUP_LABELS[group] || GROUP_LABELS.other}</h3>
                        </div>
                        <span className="text-xs text-gray-500">{templates.length} template{templates.length > 1 ? 's' : ''}</span>
                      </button>
                      {expandedTplGroups[group] && (
                        <div className="p-3 space-y-3">
                          {templates.map(tpl => (
                            <div key={tpl.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                            {/* Header row */}
                            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/50">
                              <div className="flex items-center gap-3">
                                <span className="font-medium text-sm capitalize">{tpl.event_type?.replace(/_/g, ' ')}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tpl.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                  {tpl.is_active ? 'Active' : 'Disabled'}
                                </span>
                              </div>
                              <button
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
                                onClick={() => setEditingTpl(editingTpl?.id === tpl.id ? null : { ...tpl, _tab: 'edit' })}>
                                <Pencil size={13} />{editingTpl?.id === tpl.id ? 'Close' : 'Edit'}
                              </button>
                            </div>

                            {/* Collapsed: show subject preview */}
                            {editingTpl?.id !== tpl.id && (
                              <div className="px-4 py-2">
                                <p className="text-xs text-gray-500 font-mono truncate">{tpl.subject_template || <span className="italic text-gray-300">No subject</span>}</p>
                              </div>
                            )}

                            {/* Expanded editor */}
                            {editingTpl?.id === tpl.id && (
                              <div className="p-4 space-y-4">
                                {/* Active toggle */}
                                <div className="flex items-center gap-3">
                                  <label className="text-sm font-medium w-16">Active</label>
                                  <button type="button"
                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${editingTpl.is_active ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                                    onClick={() => setEditingTpl(t => ({ ...t, is_active: !t.is_active }))}>
                                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${editingTpl.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                  </button>
                                </div>

                                {/* Subject */}
                                <div>
                                  <label className="block text-sm font-medium mb-1">Subject</label>
                                  <input className="input font-mono text-sm" value={editingTpl.subject_template || ''}
                                    onChange={e => setEditingTpl(t => ({ ...t, subject_template: e.target.value }))} />
                                  {editingTpl.subject_template && (
                                    <p className="text-xs text-gray-400 mt-1 font-mono truncate">Preview: {renderPreview(editingTpl.subject_template)}</p>
                                  )}
                                </div>

                                {/* Body editor + preview side by side */}
                                <div>
                                  <div className="flex gap-2 mb-1">
                                    <button className={`text-xs px-2.5 py-1 rounded font-medium border transition-colors ${(editingTpl._tab ?? 'edit') === 'edit' ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}
                                      onClick={() => setEditingTpl(t => ({ ...t, _tab: 'edit' }))}>HTML Source</button>
                                    <button className={`text-xs px-2.5 py-1 rounded font-medium border transition-colors ${editingTpl._tab === 'preview' ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}
                                      onClick={() => setEditingTpl(t => ({ ...t, _tab: 'preview' }))}>Preview</button>
                                    <button className={`text-xs px-2.5 py-1 rounded font-medium border transition-colors ${editingTpl._tab === 'vars' ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}
                                      onClick={() => setEditingTpl(t => ({ ...t, _tab: 'vars' }))}>Variables</button>
                                  </div>

                                  {(editingTpl._tab ?? 'edit') === 'edit' && (
                                    <textarea className="input font-mono text-xs w-full" rows={10} value={editingTpl.body_html_template || ''}
                                      onChange={e => setEditingTpl(t => ({ ...t, body_html_template: e.target.value }))} />
                                  )}

                                  {editingTpl._tab === 'preview' && (
                                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white" style={{ height: 380 }}>
                                      <iframe
                                        key={editingTpl.body_html_template}
                                        srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;font-size:14px;padding:16px;margin:0;color:#111;background:#fff}</style></head><body>${renderPreview(editingTpl.body_html_template || '')}</body></html>`}
                                        sandbox="allow-same-origin"
                                        className="w-full h-full border-0"
                                        title="Email preview"
                                      />
                                    </div>
                                  )}

                                  {editingTpl._tab === 'vars' && (
                                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                      <table className="w-full text-xs">
                                        <thead className="bg-gray-50 dark:bg-gray-700/50">
                                          <tr>
                                            <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300 w-44">Variable</th>
                                            <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Description</th>
                                            <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Sample value</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                          {(TPL_VARS[editingTpl.event_type] || []).map(v => (
                                            <tr key={v.key}>
                                              <td className="px-3 py-2">
                                                <button
                                                  className="font-mono bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded hover:bg-indigo-100 transition-colors"
                                                  title="Click to copy"
                                                  onClick={() => navigator.clipboard?.writeText(`{{${v.key}}}`)}>
                                                  {`{{${v.key}}}`}
                                                </button>
                                              </td>
                                              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{v.desc}</td>
                                              <td className="px-3 py-2 text-gray-400 font-mono">{SAMPLE_VARS[v.key] ?? '—'}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>

                                {/* Actions */}
                                <div className="flex justify-end gap-2">
                                  <button className="btn-secondary text-sm" onClick={() => setEditingTpl(null)}>Cancel</button>
                                  <button className="btn-primary text-sm" onClick={async () => {
                                    try {
                                      await notificationsApi.updateTemplate(editingTpl.id, {
                                        subject_template: editingTpl.subject_template,
                                        body_html_template: editingTpl.body_html_template,
                                        is_active: editingTpl.is_active,
                                      })
                                      toast.success('Template saved')
                                      setEditingTpl(null)
                                      notificationsApi.templates().then(r => setEmailTemplates(r.data))
                                    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
                                  }}><Save size={14} />Save</button>
                                </div>
                              </div>
                            )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {emailTemplates.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No email templates found</p>}
                </div>
              </Section>
            </div>
          )
        })()}

        {tab === 'assetcat' && (
          <div className="space-y-4">
            <div className="card p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-base">Asset Categories</h2>
                <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={() => { setShowCreateCat(true); setCatError(''); setCatForm({ label: '', color: '#6366f1' }) }}>
                  <Plus size={14} /> New Category
                </button>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {aCats.map(cat => (
                  <div key={cat.id} className="py-3">
                    {editingCatId === cat.id ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: editingCatColor }} />
                        <input className="input flex-1 min-w-0" value={editingCatLabel} onChange={e => setEditingCatLabel(e.target.value)} autoFocus />
                        <div className="flex gap-1 flex-wrap items-center">
                          {TYPE_COLORS.map(c => (
                            <button key={c} type="button" onClick={() => setEditingCatColor(c)}
                              className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${editingCatColor === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                              style={{ backgroundColor: c }} title={c} />
                          ))}
                          <input type="color" value={editingCatColor} onChange={e => setEditingCatColor(e.target.value)}
                            className="w-6 h-6 rounded cursor-pointer border border-gray-300 p-0" title="Custom color" />
                        </div>
                        <button className="btn-primary text-xs px-2 py-1" onClick={() => handleSaveCat(cat.id)}>Save</button>
                        <button className="btn-secondary text-xs px-2 py-1" onClick={() => setEditingCatId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                        <span className="font-medium text-sm flex-1">{cat.label}</span>
                        <span className="text-xs text-gray-400 font-mono">{cat.slug}</span>
                        <button className="action-icon-btn"
                          onClick={() => { setEditingCatId(cat.id); setEditingCatLabel(cat.label); setEditingCatColor(cat.color) }}>
                          <Pencil size={13} />
                        </button>
                        <button className="action-icon-btn action-icon-btn-danger"
                          onClick={() => setDeleteTargetCat(cat)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {aCats.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No categories yet.</p>}
              </div>
            </div>

            {showCreateCat && (
              <Modal title="New Asset Category" onClose={() => setShowCreateCat(false)}>
                <form onSubmit={handleCreateCat} className="space-y-4 p-4">
                  <div>
                    <label className="block text-xs font-medium mb-1">Label</label>
                    <input className="input" value={catForm.label} onChange={e => setCatForm(f => ({ ...f, label: e.target.value }))} autoFocus required />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-2">Color</label>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="w-6 h-6 rounded-full border border-gray-300 shadow-sm flex-shrink-0" style={{ backgroundColor: catForm.color }} />
                      {TYPE_COLORS.map(c => (
                        <button key={c} type="button" onClick={() => setCatForm(f => ({ ...f, color: c }))}
                          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${catForm.color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                          style={{ backgroundColor: c }} title={c} />
                      ))}
                      <input type="color" value={catForm.color} onChange={e => setCatForm(f => ({ ...f, color: e.target.value }))}
                        className="w-7 h-7 rounded cursor-pointer border border-gray-300 p-0" title="Custom color" />
                    </div>
                  </div>
                  {catError && <p className="text-sm text-red-500">{catError}</p>}
                  <div className="flex justify-end gap-2 pt-1">
                    <button type="button" className="btn-secondary" onClick={() => setShowCreateCat(false)}>Cancel</button>
                    <button type="submit" className="btn-primary">Create</button>
                  </div>
                </form>
              </Modal>
            )}

            {deleteTargetCat && (
              <ConfirmDialog
                title="Delete Category"
                message={`Delete "${deleteTargetCat.label}"? This cannot be undone.`}
                onConfirm={handleDeleteCat}
                onCancel={() => setDeleteTargetCat(null)}
              />
            )}
          </div>
        )}

        {tab === 'general' && (
          <div className="space-y-6">
            {isSuperAdmin && (
            <div className="card p-5 sm:p-6 space-y-4">
              <button
                type="button"
                className="w-full flex items-center justify-between text-left"
                onClick={() => setSystemGeneralOpen(v => !v)}
              >
                <h2 className="font-semibold text-base flex items-center gap-2">
                  <Cog size={16} className="text-gray-500" />General settings
                </h2>
                {systemGeneralOpen ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
              </button>

              {systemGeneralOpen && (
                <form onSubmit={saveGeneral} className="space-y-3 pt-1 border-t border-gray-100 dark:border-gray-700">
                  <div><label className="block text-xs font-medium mb-1">Application name</label><input className="input" value={general.app_name || ''} onChange={e => setGeneral(f => ({ ...f, app_name: e.target.value }))} /></div>
                  <div><label className="block text-xs font-medium mb-1">Application URL</label><input className="input" placeholder="https://maintenance.example.com" value={general.app_url || ''} onChange={e => setGeneral(f => ({ ...f, app_url: e.target.value }))} /></div>
                  <div>
                    <label className="block text-xs font-medium mb-1">App image (logo, tab icon, app icon)</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer text-sm">
                        <Upload size={14} />{appBrandUploading ? 'Uploading...' : 'Upload image'}
                        <input type="file" accept="image/*" className="hidden" disabled={appBrandUploading} onChange={e => uploadAppBrandImage(e.target.files?.[0])} />
                      </label>
                      {general.app_brand_image_url && (
                        <button type="button" className="px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-sm" onClick={() => setGeneral(f => ({ ...f, app_brand_image_url: '' }))}>
                          Remove image
                        </button>
                      )}
                    </div>
                    {general.app_brand_image_url && (
                      <div className="mt-2 inline-flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 p-2.5">
                        <img src={general.app_brand_image_url} alt="App brand" className="w-10 h-10 object-contain rounded bg-white" />
                        <span className="text-xs text-gray-500 break-all max-w-[340px]">{general.app_brand_image_url}</span>
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-1">Used for sidebar logo, browser tab favicon and app icon.</p>
                  </div>
                  <div className="flex justify-end pt-2">
                    <button type="submit" className="btn-primary">Save</button>
                  </div>
                </form>
              )}
            </div>
            )}

            {isSuperAdmin && (
            <div className="card p-5 sm:p-6 space-y-4">
              <button
                type="button"
                className="w-full flex items-center justify-between text-left"
                onClick={() => setSystemAuditOpen(v => !v)}
              >
                <h2 className="font-semibold text-base flex items-center gap-2">
                  <Shield size={16} className="text-gray-500" />Audit Log Retention
                </h2>
                {systemAuditOpen ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
              </button>

              {systemAuditOpen && (
                <form onSubmit={saveGeneral} className="space-y-4 pt-1 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-sm text-gray-500">
                    Configure for how long audit entries remain queryable. This is enforced by the API and used by the automatic purge job.
                  </p>
                  <div>
                    <label className="block text-xs font-medium mb-1">Retention (days)</label>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      className="input w-40"
                      value={general.audit_log_retention_days ?? 365}
                      onChange={e => {
                        const n = Number.parseInt(e.target.value, 10)
                        setGeneral(f => ({ ...f, audit_log_retention_days: Number.isFinite(n) ? n : 365 }))
                      }}
                    />
                    <p className="text-xs text-gray-400 mt-1">Recommended baseline for ISO aligned operations: 365 days searchable, longer archival outside app if required.</p>
                  </div>
                  <label className="flex items-center gap-3 text-sm cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-brand-600"
                      checked={general.audit_log_auto_purge !== false}
                      onChange={e => setGeneral(f => ({ ...f, audit_log_auto_purge: e.target.checked }))}
                    />
                    Enable automatic daily purge based on retention window
                  </label>
                  <div className="flex justify-end pt-1">
                    <button type="submit" className="btn-primary">Save</button>
                  </div>
                </form>
              )}
            </div>
            )}

            {isSuperAdmin && (
            <div className="card p-5 sm:p-6 space-y-4">
              <button
                type="button"
                className="w-full flex items-center justify-between text-left"
                onClick={() => setSystemDemoOpen(v => !v)}
              >
                <h2 className="font-semibold text-base flex items-center gap-2">
                  <Server size={16} className="text-gray-500" />Demo
                </h2>
                {systemDemoOpen ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
              </button>

              {systemDemoOpen && (
                <div className="space-y-4 pt-1 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-sm text-gray-500">
                    Create or remove a full demo dataset (assets, services, maintenances, licenses) for product walkthroughs.
                  </p>

                  <div className="text-xs text-gray-500 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                      {demoLoading ? (
                        <span>Loading demo status...</span>
                    ) : demoStatus ? (
                      <span>
                        Assets: <strong>{demoStatus.asset_count || 0}</strong> · Services: <strong>{demoStatus.service_count || 0}</strong> · Maintenances: <strong>{demoStatus.maintenance_count || 0}</strong> · Incidents: <strong>{demoStatus.incident_count || 0}</strong> · Suppliers: <strong>{demoStatus.supplier_count || 0}</strong> · Licenses: <strong>{demoStatus.license_count || 0}</strong> · Local users: <strong>{demoStatus.local_user_count || 0}</strong> · Local groups: <strong>{demoStatus.local_group_count || 0}</strong> · Asset deps: <strong>{demoStatus.asset_dependency_count || 0}</strong> · Service deps: <strong>{demoStatus.service_dependency_count || 0}</strong>
                        {demoStatus.seeded_at ? ` · Seeded at: ${format(new Date(demoStatus.seeded_at), 'MM/dd/yyyy HH:mm')}` : ''}
                      </span>
                    ) : (
                      <span>Demo status unavailable.</span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 justify-end">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleCreateDemoData}
                      disabled={demoWorking || demoLoading || !!demoStatus?.exists}
                    >
                      {demoWorking ? 'Working...' : 'Create demo data'}
                    </button>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => setShowDemoClearConfirm(true)}
                      disabled={demoWorking || demoLoading || !demoStatus?.exists}
                    >
                      {demoWorking ? 'Working...' : 'Remove demo data'}
                    </button>
                  </div>
                </div>
              )}
            </div>
            )}


            {showDemoClearConfirm && (
              <ConfirmDialog
                title="Remove Demo Data"
                message="Remove all demo data created by the demo seed feature? This will delete demo assets, services, maintenances, incidents, suppliers, licenses, local users and groups."
                danger
                confirmLabel="Remove"
                onConfirm={handleClearDemoData}
                onCancel={() => setShowDemoClearConfirm(false)}
              />
            )}
            <div className="card p-5 sm:p-6 space-y-4">
              <button
                type="button"
                className="w-full flex items-center justify-between text-left"
                onClick={() => setSystemDateTimeOpen(v => !v)}
              >
                <h2 className="font-semibold text-base flex items-center gap-2">
                  <Clock size={16} className="text-gray-500" />Date &amp; Time
                </h2>
                {systemDateTimeOpen ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
              </button>

              {systemDateTimeOpen && (
                <>
                  <p className="text-sm text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-3">
                    Configure the NTP server to verify clock accuracy and the timezone applied to all timestamps in the application.
                  </p>
                  <form onSubmit={saveNtp} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium mb-1">NTP Server</label>
                        <div className="flex gap-2">
                          <input className="input font-mono flex-1" placeholder="pool.ntp.org"
                            value={ntp.ntp_server}
                            onChange={e => { setNtp(n => ({ ...n, ntp_server: e.target.value })); setNtpDirty(true) }} />
                          <button type="button" onClick={handleQueryNtp} disabled={ntpSyncing || !ntp.ntp_server}
                            className="btn-secondary flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50">
                            <RefreshCw size={13} className={ntpSyncing ? 'animate-spin' : ''} />{ntpSyncing ? 'Querying...' : 'Query NTP'}
                          </button>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">e.g. <code>pool.ntp.org</code>, <code>ntp.inrim.it</code>, <code>time.windows.com</code></p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Timezone (IANA)</label>
                        <input className="input font-mono" placeholder="Europe/Rome"
                          value={ntp.timezone}
                          onChange={e => { setNtp(n => ({ ...n, timezone: e.target.value })); setNtpDirty(true) }} />
                        <p className="text-xs text-gray-400 mt-1">e.g. <code>Europe/Rome</code>, <code>UTC</code>, <code>America/New_York</code></p>
                      </div>
                    </div>

                    {syncResult && (
                      <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${syncResult.success ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                        {syncResult.success ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
                        {syncResult.message}
                      </div>
                    )}

                    <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-200">
                      <AlertCircle size={15} className="shrink-0 mt-0.5" />
                      <span>The timezone is applied immediately to the running process and persisted in the database (survives restarts). The <strong>Query NTP</strong> button checks reachability and reports the offset between the NTP server clock and the server's system clock — it does not modify the system clock (use your OS/Docker host NTP daemon for that).</span>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button type="submit" disabled={ntpSaving || !ntpDirty}
                        className="btn-primary flex items-center gap-2 disabled:opacity-50">
                        <Save size={14} />{ntpSaving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Maintenance Types modals */}
      {showCreateType && (
        <Modal title="New Maintenance Type" onClose={() => setShowCreateType(false)}>
          <form onSubmit={handleCreateType} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Label *</label>
              <input className="input" placeholder="e.g. Security Patch" value={typeForm.label}
                onChange={e => {
                  const label = e.target.value
                  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
                  setTypeForm(f => ({ ...f, label, slug }))
                }} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Slug (permanent key)</label>
              <input className="input font-mono text-sm" placeholder="security_patch" value={typeForm.slug}
                onChange={e => setTypeForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))} />
              <p className="text-xs text-gray-400 mt-1">Auto-generated from label. Cannot be changed after creation.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Color</label>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="w-6 h-6 rounded-full border border-gray-300 shadow-sm flex-shrink-0" style={{ backgroundColor: typeForm.color }} />
                {TYPE_COLORS.map(c => (
                  <button key={c} type="button"
                    onClick={() => setTypeForm(f => ({ ...f, color: c }))}
                    className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${typeForm.color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
                <input type="color" value={typeForm.color}
                  onChange={e => setTypeForm(f => ({ ...f, color: e.target.value }))}
                  className="w-7 h-7 rounded cursor-pointer border border-gray-300 p-0"
                  title="Custom color" />
              </div>
            </div>
            {typeError && <p className="text-sm text-red-600">{typeError}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreateType(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Create</button>
            </div>
          </form>
        </Modal>
      )}
      {deleteTargetType && (
        <ConfirmDialog title="Delete Type" danger confirmLabel="Delete"
          message={`Delete type "${deleteTargetType.label}" (${deleteTargetType.slug})? This will fail if any maintenance windows use it.`}
          onConfirm={handleDeleteType} onCancel={() => setDeleteTargetType(null)} />
      )}

      {/* API Keys modals */}
      {showCreateKey && (
        <Modal title="New API Key" onClose={() => setShowCreateKey(false)} size="sm">
          <form onSubmit={handleCreateKey} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Name *</label><input className="input" required value={keyForm.name} onChange={e => setKeyForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">Expires (optional)</label><input type="datetime-local" className="input" value={keyForm.expires_at} onChange={e => setKeyForm(f => ({ ...f, expires_at: e.target.value }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreateKey(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Create</button>
            </div>
          </form>
        </Modal>
      )}
      {newKey && (
        <Modal title="Key created" onClose={() => setNewKey(null)} size="sm">
          <p className="text-sm text-gray-600 mb-3">Copy this key — it won't be shown again.</p>
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border">
            <code className="flex-1 text-xs break-all">{newKey}</code>
            <button onClick={() => { navigator.clipboard.writeText(newKey); toast.success('Copied') }}><Copy size={16} /></button>
          </div>
          <div className="flex justify-end mt-4">
            <button className="btn-primary" onClick={() => setNewKey(null)}>I've saved the key</button>
          </div>
        </Modal>
      )}
      {deleteTargetKey && (
        <ConfirmDialog title="Delete API Key" message={`Delete "${deleteTargetKey.name}"?`} danger confirmLabel="Delete"
          onConfirm={handleDeleteKey} onCancel={() => setDeleteTargetKey(null)} />
      )}
    </Layout>
  )
}
