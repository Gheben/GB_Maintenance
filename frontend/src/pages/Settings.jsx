import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { Modal, ConfirmDialog } from '../components/Modal'
import { settingsApi, templatesApi, apikeysApi, notificationsApi } from '../api'
import { toast } from '../components/Toast'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { Copy, ExternalLink, Shield, Save, CheckCircle, AlertCircle, Server, XCircle, Plus, Trash2, Eye, RotateCcw, Clock, FileCode, RefreshCw } from 'lucide-react'

const TYPES = ['planned','emergency','upgrade','security_patch','infrastructure','other']
const IMPACTS = ['critical','high','medium','low']

const NOTIF_VARIABLES = [
  { key: '{{title}}',           desc: 'Titolo manutenzione' },
  { key: '{{id}}',              desc: 'ID manutenzione' },
  { key: '{{type}}',            desc: 'Tipo (planned, emergency, ...)' },
  { key: '{{impact_level}}',    desc: 'Livello impatto (critical, high, ...)' },
  { key: '{{status}}',          desc: 'Stato corrente' },
  { key: '{{scheduled_start}}', desc: 'Inizio pianificato' },
  { key: '{{scheduled_end}}',   desc: 'Fine pianificata' },
  { key: '{{actual_start}}',    desc: 'Inizio effettivo' },
  { key: '{{actual_end}}',      desc: 'Fine effettiva' },
  { key: '{{description}}',     desc: 'Descrizione' },
  { key: '{{notes}}',           desc: 'Note' },
  { key: '{{app_url}}',         desc: 'URL applicazione' },
]

function Section({ title, children }) {
  return (
    <div className="card p-5 sm:p-6 space-y-4">
      <h2 className="font-semibold text-base border-b border-gray-100 dark:border-gray-700 pb-2">{title}</h2>
      {children}
    </div>
  )
}

export default function Settings() {
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
  const [general, setGeneral] = useState({ app_name: 'GB Maintenance', app_url: '' })
  const [loading, setLoading] = useState(false)

  // NTP / Timezone
  const [ntp, setNtp] = useState({ ntp_server: 'pool.ntp.org', timezone: 'Europe/Rome' })
  const [ntpDirty, setNtpDirty] = useState(false)
  const [ntpSaving, setNtpSaving] = useState(false)

  // Notification templates
  const [notifTemplates, setNotifTemplates] = useState([])
  const [selectedNotifId, setSelectedNotifId] = useState(null)
  const [notifForm, setNotifForm] = useState({ subject_template: '', body_html_template: '' })
  const [notifDirty, setNotifDirty] = useState(false)
  const [notifSaving, setNotifSaving] = useState(false)
  const [notifPreview, setNotifPreview] = useState(false)

  // Templates state
  const [templates, setTemplates] = useState([])
  const [showCreateTemplate, setShowCreateTemplate] = useState(false)
  const [deleteTargetTemplate, setDeleteTargetTemplate] = useState(null)
  const [templateForm, setTemplateForm] = useState({ name: '', type: 'planned', impact_level: 'medium', duration_minutes: 60, description: '' })

  // API Keys state
  const [keys, setKeys] = useState([])
  const [showCreateKey, setShowCreateKey] = useState(false)
  const [newKey, setNewKey] = useState(null)
  const [deleteTargetKey, setDeleteTargetKey] = useState(null)
  const [keyForm, setKeyForm] = useState({ name: '', expires_at: '' })

  useEffect(() => {
    settingsApi.getSmtp().then(r => setSmtp(r.data)).catch(() => {})
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
    settingsApi.getNtp().then(r => setNtp(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'templates') {
      templatesApi.list().then(r => setTemplates(r.data)).catch(() => {})
      notificationsApi.templates().then(r => {
        setNotifTemplates(r.data)
        if (r.data.length > 0 && !selectedNotifId) {
          const first = r.data[0]
          setSelectedNotifId(first.id)
          setNotifForm({ subject_template: first.subject_template || '', body_html_template: first.body_html_template || '' })
        }
      }).catch(() => {})
    }
    if (tab === 'apikeys') apikeysApi.list().then(r => setKeys(r.data)).catch(() => {})
  }, [tab])

  const saveSmtp = async (e) => {
    e.preventDefault(); setLoading(true)
    try { await settingsApi.saveSmtp(smtp); toast.success('SMTP salvato') }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
    finally { setLoading(false) }
  }

  const testSmtp = async () => {
    setLoading(true)
    try { await settingsApi.testSmtp(smtp); toast.success('SMTP funzionante') }
    catch (err) { toast.error(err.response?.data?.error || 'Test fallito') }
    finally { setLoading(false) }
  }

  const saveLdap = async (e) => {
    e.preventDefault(); setLoading(true)
    try {
      await settingsApi.saveLdap(ldap)
      toast.success('LDAP salvato')
      if (ldap.bind_password) setLdapSavedHasPassword(true)
    }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
    finally { setLoading(false) }
  }

  const testLdap = async () => {
    setLdapTesting(true); setLdapTestResult(null)
    try {
      const res = await settingsApi.testLdap(ldap)
      setLdapTestResult({ ok: true, message: res.data?.message || 'Connessione riuscita' })
    } catch (err) {
      setLdapTestResult({ ok: false, message: err.response?.data?.error || 'Test fallito' })
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
    try { await settingsApi.saveGeneral(general); toast.success('Impostazioni salvate') }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const saveNtp = async (e) => {
    e.preventDefault()
    setNtpSaving(true)
    try { await settingsApi.saveNtp(ntp); setNtpDirty(false); toast.success('Configurazione NTP salvata') }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
    finally { setNtpSaving(false) }
  }

  const selectNotifTemplate = (tpl) => {
    setSelectedNotifId(tpl.id)
    setNotifForm({ subject_template: tpl.subject_template || '', body_html_template: tpl.body_html_template || '' })
    setNotifDirty(false)
    setNotifPreview(false)
  }

  const saveNotifTemplate = async (e) => {
    e.preventDefault()
    if (!selectedNotifId) return
    setNotifSaving(true)
    try {
      await notificationsApi.updateTemplate(selectedNotifId, notifForm)
      setNotifDirty(false)
      toast.success('Template notifica salvato')
      notificationsApi.templates().then(r => setNotifTemplates(r.data)).catch(() => {})
    } catch (err) { toast.error(err.response?.data?.error || 'Errore') }
    finally { setNotifSaving(false) }
  }

  const saveSaml = async (e) => {
    e.preventDefault(); setLoading(true)
    try { await settingsApi.saveSaml(saml); toast.success('Configurazione SAML salvata') }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
    finally { setLoading(false) }
  }

  const handleCreateTemplate = async (e) => {
    e.preventDefault()
    try { await templatesApi.create(templateForm); toast.success('Template creato'); setShowCreateTemplate(false); setTemplateForm({ name: '', type: 'planned', impact_level: 'medium', duration_minutes: 60, description: '' }); templatesApi.list().then(r => setTemplates(r.data)) }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const handleDeleteTemplate = async () => {
    try { await templatesApi.delete(deleteTargetTemplate.id); toast.success('Template eliminato'); setDeleteTargetTemplate(null); templatesApi.list().then(r => setTemplates(r.data)) }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
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
    try { await apikeysApi.delete(deleteTargetKey.id); toast.success('Chiave eliminata'); setDeleteTargetKey(null); apikeysApi.list().then(r => setKeys(r.data)) }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const spBaseUrl = saml.sp_base_url || window.location.origin

  const TABS = [['smtp','SMTP & Email'],['ldap','LDAP / AD'],['saml','SAML / SSO'],['templates','Template'],['apikeys','API Keys'],['general','Sistema']]

  return (
    <Layout title="Impostazioni">
      <div className="max-w-2xl space-y-4">
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 flex-wrap">
          {TABS.map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm font-medium ${tab === k ? 'border-b-2 border-brand-600 text-brand-600' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
          ))}
        </div>

        {tab === 'smtp' && (
          <Section title="Configurazione SMTP">
            <form onSubmit={saveSmtp} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium mb-1">Host *</label><input className="input" required value={smtp.host} onChange={e => setSmtp(f => ({ ...f, host: e.target.value }))} /></div>
                <div><label className="block text-xs font-medium mb-1">Porta</label><input className="input" type="number" value={smtp.port} onChange={e => setSmtp(f => ({ ...f, port: parseInt(e.target.value) }))} /></div>
              </div>
              <div><label className="block text-xs font-medium mb-1">Username</label><input className="input" value={smtp.user} onChange={e => setSmtp(f => ({ ...f, user: e.target.value }))} /></div>
              <div><label className="block text-xs font-medium mb-1">Password</label><input className="input" type="password" placeholder="••••••••" value={smtp.pass === '********' ? '' : smtp.pass} onChange={e => setSmtp(f => ({ ...f, pass: e.target.value }))} /></div>
              <div><label className="block text-xs font-medium mb-1">From</label><input className="input" value={smtp.from} onChange={e => setSmtp(f => ({ ...f, from: e.target.value }))} /></div>
              <div className="flex gap-3 pt-2">
                <button type="button" className="btn-secondary" disabled={loading} onClick={testSmtp}>Test connessione</button>
                <button type="submit" className="btn-primary" disabled={loading}>Salva</button>
              </div>
            </form>
          </Section>
        )}

        {tab === 'ldap' && (
          <form onSubmit={saveLdap} className="space-y-4">
            {/* Enable */}
            <div className="card p-5">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={ldap.enabled}
                  onChange={e => setLdap(f => ({ ...f, enabled: e.target.checked }))}
                  className="w-4 h-4 accent-brand-600" />
                <span className="font-semibold text-gray-800 dark:text-gray-100">Abilita autenticazione LDAP / Active Directory</span>
              </label>
              {ldap.enabled && (
                <p className="mt-2 text-sm text-cyan-700 dark:text-cyan-300">LDAP abilitato — gli utenti potranno accedere con le credenziali di dominio.</p>
              )}
            </div>

            <div className={`space-y-4 transition-opacity duration-200 ${!ldap.enabled ? 'opacity-40 pointer-events-none' : ''}`}>
              {/* Connessione */}
              <div className="card p-5 space-y-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Connessione LDAP</h3>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Server LDAP</label>
                  <input className="input" value={ldap.url}
                    onChange={e => setLdap(f => ({ ...f, url: e.target.value }))}
                    placeholder="ldaps://dc.azienda.local  oppure  ldap://192.168.1.10" />
                  <p className="mt-1 text-xs text-gray-400">Usa <code>ldaps://</code> per LDAP over TLS (porta 636), <code>ldap://</code> per connessione non cifrata (porta 389).</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Dominio Active Directory</label>
                  <input className="input" value={ldap.domain}
                    onChange={e => setLdap(f => ({ ...f, domain: e.target.value }))}
                    placeholder="azienda.local" />
                  <p className="mt-1 text-xs text-gray-400">Usato per il bind del service account nel formato <code>username@dominio</code>.</p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-gray-500">Base DN</label>
                    {ldap.domain && (
                      <button type="button"
                        onClick={() => setLdap(f => ({ ...f, base_dn: computeBaseDn(f.domain) }))}
                        className="text-xs text-brand-600 hover:underline">
                        Deriva dal dominio
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
                  Ignora verifica certificato TLS
                </label>
              </div>

              {/* Service Account */}
              <div className="card p-5 space-y-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Service account</h3>
                <p className="text-xs text-gray-400">Account usato per cercare gli utenti in AD. Si autentica come <code>username@dominio</code>.</p>
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
                      placeholder={ldapSavedHasPassword ? '••••••••  (lascia vuoto per mantenere)' : 'Password service account'} />
                  </div>
                </div>
              </div>

              {/* Ricerca utenti */}
              <div className="card p-5 space-y-4">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ricerca utenti</h3>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">User filter</label>
                  <input className="input font-mono text-xs" value={ldap.user_filter}
                    onChange={e => setLdap(f => ({ ...f, user_filter: e.target.value }))}
                    placeholder="(sAMAccountName={{username}})" />
                  <p className="mt-1 text-xs text-gray-400">{'Usa {{username}} come segnaposto per lo username inserito al login.'}</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
                  <input type="checkbox" checked={ldap.ad_mode}
                    onChange={e => setLdap(f => ({ ...f, ad_mode: e.target.checked }))}
                    className="accent-brand-600" />
                  <span>
                    Modalità Active Directory
                    <span className="text-gray-400 text-xs ml-1 font-normal">(gruppi nidificati via LDAP_MATCHING_RULE_IN_CHAIN)</span>
                  </span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-4 flex-wrap">
                <button type="button" onClick={testLdap} disabled={ldapTesting || !ldap.url}
                  className="btn-secondary flex items-center gap-2 disabled:opacity-50">
                  <Server size={15} />{ldapTesting ? 'Test in corso...' : 'Test connessione'}
                </button>
                {ldapTestResult && (
                  <span className={`flex items-center gap-1.5 text-sm font-medium ${ldapTestResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                    {ldapTestResult.ok ? <CheckCircle size={15} /> : <XCircle size={15} />}
                    {ldapTestResult.message}
                  </span>
                )}
                <div className="flex-1" />
                <button type="submit" className="btn-primary flex items-center gap-2" disabled={loading}>
                  <Save size={14} />{loading ? 'Salvataggio...' : 'Salva impostazioni LDAP'}
                </button>
              </div>
            </div>
          </form>
        )}

        {tab === 'saml' && (
          <Section title="Autenticazione SAML 2.0 / SSO">
            <form onSubmit={saveSaml} className="space-y-5">
              <p className="text-sm text-gray-500">
                Abilita il login tramite un Identity Provider SAML (es. NetScaler, ADFS, Azure AD).
                Il Service Provider è configurato come SP-initiated (il browser viene reindirizzato all&apos;IdP e poi tornato qui).
              </p>

              {/* Enable */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" id="saml-enabled" checked={saml.enabled}
                  onChange={e => setSaml(s => ({ ...s, enabled: e.target.checked, auto_redirect: e.target.checked ? s.auto_redirect : false }))}
                  className="w-4 h-4 accent-brand-600" />
                <span className="text-sm font-medium">Abilita autenticazione SAML 2.0</span>
              </label>

              {/* Auto-redirect */}
              {saml.enabled && (
                <label className="flex items-start gap-3 cursor-pointer bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg px-4 py-3">
                  <input type="checkbox" checked={!!saml.auto_redirect}
                    onChange={e => setSaml(s => ({ ...s, auto_redirect: e.target.checked }))}
                    className="w-4 h-4 accent-blue-600 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-sm font-medium">Reindirizzamento automatico SSO (auto-redirect)</span>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Quando abilitato, il browser viene reindirizzato direttamente all&apos;Identity Provider (NetScaler)
                      senza mostrare il form di login locale. Il login locale rimane accessibile su{' '}
                      <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">/login?local</code>.
                    </p>
                  </div>
                </label>
              )}

              {/* Dati da comunicare all'IdP */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4 space-y-3">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">Dati da comunicare all&apos;amministratore IdP</p>
                <div className="space-y-2">
                  <div>
                    <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">ACS URL (Assertion Consumer Service):</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <code className="flex-1 text-xs bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-700 rounded px-2 py-1 break-all">{spBaseUrl}/api/auth/saml/acs</code>
                      <button type="button" onClick={() => { navigator.clipboard.writeText(`${spBaseUrl}/api/auth/saml/acs`); toast.success('Copiato') }}
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
                <label className="block text-xs font-medium mb-1">SP Base URL <span className="text-gray-400 font-normal">(URL pubblico di questa applicazione)</span></label>
                <input className="input" placeholder="https://maintenance.azienda.it"
                  value={saml.sp_base_url}
                  onChange={e => setSaml(s => ({ ...s, sp_base_url: e.target.value }))} />
                <p className="text-xs text-gray-400 mt-1">Deve corrispondere all&apos;URL con cui gli utenti accedono all&apos;applicazione.</p>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">SP Entity ID <span className="text-gray-400 font-normal">(lascia vuoto per usare il default)</span></label>
                <input className="input" placeholder={`${spBaseUrl}/api/auth/saml/metadata`}
                  value={saml.sp_entity_id}
                  onChange={e => setSaml(s => ({ ...s, sp_entity_id: e.target.value }))} />
              </div>

              {/* IdP Config */}
              <div>
                <label className="block text-xs font-medium mb-1">IdP SSO URL <span className="text-gray-400 font-normal">(URL di login dell&apos;Identity Provider)</span></label>
                <input className="input" placeholder="https://nfactor.azienda.it/saml/login"
                  value={saml.idp_sso_url}
                  onChange={e => setSaml(s => ({ ...s, idp_sso_url: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">IdP SLO URL <span className="text-gray-400 font-normal">(Single Logout — opzionale)</span></label>
                <input className="input" placeholder="https://nfactor.azienda.it/cgi/tmlogout"
                  value={saml.idp_slo_url}
                  onChange={e => setSaml(s => ({ ...s, idp_slo_url: e.target.value }))} />
                <p className="text-xs text-gray-400 mt-1">Se configurato, il logout da questa app terminerà anche la sessione sull&apos;Identity Provider (NetScaler).</p>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Certificato IdP (X.509 PEM)</label>
                <textarea className="input font-mono text-xs" rows={6}
                  placeholder={'-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----'}
                  value={saml.idp_cert}
                  onChange={e => setSaml(s => ({ ...s, idp_cert: e.target.value }))} />
                <p className="text-xs text-gray-400 mt-1">Incolla il certificato X.509 fornito dall&apos;amministratore NetScaler. Accettato con o senza intestazione PEM.</p>
              </div>

              {/* Attribute mapping */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Attributo username <span className="text-gray-400 font-normal">(vuoto = NameID)</span></label>
                  <input className="input text-xs" placeholder="NameID (default)"
                    value={saml.username_attribute}
                    onChange={e => setSaml(s => ({ ...s, username_attribute: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Attributo display name</label>
                  <input className="input text-xs" placeholder="displayName"
                    value={saml.display_name_attribute}
                    onChange={e => setSaml(s => ({ ...s, display_name_attribute: e.target.value }))} />
                </div>
              </div>

              {/* Default role */}
              <div>
                <label className="block text-xs font-medium mb-1">Ruolo predefinito per nuovi utenti SAML</label>
                <select className="input" value={saml.default_role}
                  onChange={e => setSaml(s => ({ ...s, default_role: e.target.value }))}>
                  {['admin','change_manager','operator','viewer','subscriber'].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1">Il ruolo può essere modificato individualmente in &quot;Gestione utenti&quot; dopo il primo accesso.</p>
              </div>

              {/* Require group match */}
              <label className="flex items-start gap-3 cursor-pointer bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg px-4 py-3">
                <input type="checkbox" checked={!!saml.require_group_match}
                  onChange={e => setSaml(s => ({ ...s, require_group_match: e.target.checked }))}
                  className="w-4 h-4 accent-red-600 mt-0.5 shrink-0" />
                <div>
                  <span className="text-sm font-medium">Nega l&apos;accesso se nessun gruppo LDAP corrisponde</span>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Quando abilitato, gli utenti autenticati dall&apos;IdP ma non appartenenti a nessun gruppo LDAP mappato
                    vengono <strong>bloccati</strong>. Quando disabilitato (default) ricevono il <em>Ruolo predefinito</em> configurato sopra.
                  </p>
                </div>
              </label>

              <div className="flex justify-end pt-1">
                <button type="submit" className="btn-primary flex items-center gap-2" disabled={loading}>
                  <Save size={14} />{loading ? 'Salvataggio...' : 'Salva configurazione SAML'}
                </button>
              </div>
            </form>
          </Section>
        )}

        {tab === 'templates' && (
          <div className="space-y-6">
            {/* ── Maintenance window templates ── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-700">Template Manutenzioni</h3>
                  <p className="text-sm text-gray-500 mt-0.5">Modelli predefiniti per la creazione rapida di manutenzioni.</p>
                </div>
                <button className="btn-primary" onClick={() => setShowCreateTemplate(true)}><Plus size={15} />Nuovo Template</button>
              </div>
              <div className="space-y-3">
                {templates.map(t => (
                  <div key={t.id} className="card p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium">{t.name}</p>
                      <p className="text-xs text-gray-500">{t.type} · {t.impact_level} · {t.duration_minutes} min</p>
                      {t.description && <p className="text-xs text-gray-400 mt-1">{t.description}</p>}
                    </div>
                    <button className="p-1 text-red-500 hover:bg-red-50 rounded" onClick={() => setDeleteTargetTemplate(t)}><Trash2 size={14} /></button>
                  </div>
                ))}
                {templates.length === 0 && <p className="text-center text-gray-500 py-8">Nessun template</p>}
              </div>
            </div>

            {/* ── Notification email templates ── */}
            <div className="border-t border-gray-200 pt-6 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-gray-700 flex items-center gap-2"><FileCode size={16} />Template Email Notifiche</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Personalizza i template HTML delle email di notifica inviate per ogni evento. Usa le variabili per inserire dati dinamici.
                </p>
              </div>

              {notifTemplates.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {notifTemplates.map(t => (
                    <button key={t.id} onClick={() => selectNotifTemplate(t)}
                      className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                        selectedNotifId === t.id
                          ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      {t.name || t.event_type}
                      <span className={`ml-1 text-xs font-normal ${t.is_active ? 'text-green-500' : 'text-gray-400'}`}>
                        {t.is_active ? '●' : '○'}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {selectedNotifId && (() => {
                const tpl = notifTemplates.find(t => t.id === selectedNotifId)
                return (
                  <div className="card p-5 space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-700">{tpl?.name || tpl?.event_type}</p>
                        <p className="text-xs text-gray-400 font-mono mt-0.5">{tpl?.event_type}</p>
                      </div>
                      <button type="button" onClick={() => setNotifPreview(v => !v)}
                        className="text-xs border border-gray-300 rounded-lg px-3 py-1.5 text-gray-600 hover:bg-gray-100 flex items-center gap-1.5">
                        <Eye size={13} />{notifPreview ? 'Modifica' : 'Anteprima'}
                      </button>
                    </div>

                    {/* Subject */}
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Oggetto email</label>
                      <input className="input font-mono text-sm"
                        value={notifForm.subject_template}
                        onChange={e => { setNotifForm(f => ({ ...f, subject_template: e.target.value })); setNotifDirty(true) }}
                        placeholder="[GB Maintenance] {{title}}" />
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {NOTIF_VARIABLES.slice(0, 5).map(v => (
                          <button key={v.key} type="button" title={v.desc}
                            onClick={() => { setNotifForm(f => ({ ...f, subject_template: f.subject_template + v.key })); setNotifDirty(true) }}
                            className="font-mono text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded px-2 py-0.5 hover:bg-blue-100 transition-colors">
                            {v.key}
                          </button>
                        ))}
                      </div>
                    </div>

                    <hr className="border-gray-100" />

                    {/* Body HTML */}
                    <div>
                      <p className="text-sm text-gray-500 mb-2">Corpo HTML — variabili disponibili:</p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {NOTIF_VARIABLES.map(v => (
                          <button key={v.key} type="button" title={v.desc}
                            onClick={() => {
                              if (!notifPreview) {
                                setNotifForm(f => ({ ...f, body_html_template: f.body_html_template + v.key }))
                                setNotifDirty(true)
                              }
                            }}
                            className="font-mono text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded px-2 py-0.5 hover:bg-blue-100 transition-colors">
                            {v.key}
                          </button>
                        ))}
                      </div>

                      {notifPreview ? (
                        <div className="border border-gray-200 rounded-lg p-4 min-h-[280px] overflow-auto bg-white"
                          dangerouslySetInnerHTML={{ __html: notifForm.body_html_template
                            .replace(/{{title}}/g, 'Manutenzione server produzione')
                            .replace(/{{id}}/g, '42')
                            .replace(/{{type}}/g, 'planned')
                            .replace(/{{impact_level}}/g, 'high')
                            .replace(/{{status}}/g, 'scheduled')
                            .replace(/{{scheduled_start}}/g, new Date().toISOString())
                            .replace(/{{scheduled_end}}/g, new Date(Date.now() + 3600000).toISOString())
                            .replace(/{{actual_start}}/g, '')
                            .replace(/{{actual_end}}/g, '')
                            .replace(/{{description}}/g, 'Aggiornamento sistema operativo e patch di sicurezza.')
                            .replace(/{{notes}}/g, 'Controllare servizi dopo la finestra.')
                            .replace(/{{app_url}}/g, window.location.origin)
                          }}
                        />
                      ) : (
                        <textarea
                          className="w-full font-mono text-xs border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
                          rows={16} value={notifForm.body_html_template} spellCheck={false}
                          onChange={e => { setNotifForm(f => ({ ...f, body_html_template: e.target.value })); setNotifDirty(true) }}
                        />
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <button type="button" onClick={saveNotifTemplate} disabled={notifSaving || !notifDirty}
                        className="btn-primary flex items-center gap-2 disabled:opacity-50">
                        <Save size={14} />{notifSaving ? 'Salvataggio...' : 'Salva template'}
                      </button>
                      <button type="button"
                        onClick={() => {
                          const orig = notifTemplates.find(t => t.id === selectedNotifId)
                          if (orig) { setNotifForm({ subject_template: orig.subject_template || '', body_html_template: orig.body_html_template || '' }); setNotifDirty(false) }
                        }}
                        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">
                        <RotateCcw size={13} />Ripristina
                      </button>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        )}

        {tab === 'apikeys' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => setShowCreateKey(true)}><Plus size={15} />Nuova Chiave</button>
            </div>
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-[500px] w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-700/50">
                    <tr>{['Nome','Prefisso','Scadenza','Ultima uso','Azioni'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {keys.map(k => (
                      <tr key={k.id}>
                        <td className="px-4 py-3">{k.name}</td>
                        <td className="px-4 py-3 font-mono text-xs">{k.key_prefix}...</td>
                        <td className="px-4 py-3 text-gray-500">{k.expires_at ? format(new Date(k.expires_at), 'dd/MM/yyyy', { locale: it }) : '∞'}</td>
                        <td className="px-4 py-3 text-gray-500">{k.last_used_at ? format(new Date(k.last_used_at), 'dd/MM HH:mm', { locale: it }) : '—'}</td>
                        <td className="px-4 py-3">
                          <button className="p-1 text-red-500 hover:bg-red-50 rounded" onClick={() => setDeleteTargetKey(k)}><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                    {keys.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-gray-500">Nessuna chiave API</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'general' && (
          <div className="space-y-6">
            <Section title="Impostazioni generali">
              <form onSubmit={saveGeneral} className="space-y-3">
                <div><label className="block text-xs font-medium mb-1">Nome applicazione</label><input className="input" value={general.app_name || ''} onChange={e => setGeneral(f => ({ ...f, app_name: e.target.value }))} /></div>
                <div><label className="block text-xs font-medium mb-1">URL applicazione</label><input className="input" placeholder="https://maintenance.example.com" value={general.app_url || ''} onChange={e => setGeneral(f => ({ ...f, app_url: e.target.value }))} /></div>
                <div className="flex justify-end pt-2">
                  <button type="submit" className="btn-primary">Salva</button>
                </div>
              </form>
            </Section>

            <div className="card p-5 sm:p-6 space-y-4">
              <h2 className="font-semibold text-base border-b border-gray-100 dark:border-gray-700 pb-2 flex items-center gap-2">
                <Clock size={16} className="text-gray-500" />Date &amp; Time
              </h2>
              <p className="text-sm text-gray-500">
                Configura il server NTP per la verifica dell&apos;accuratezza dell&apos;orologio e il fuso orario applicato a tutti i timestamp nell&apos;applicazione.
              </p>
              <form onSubmit={saveNtp} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium mb-1">Server NTP</label>
                    <input className="input font-mono" placeholder="pool.ntp.org"
                      value={ntp.ntp_server}
                      onChange={e => { setNtp(n => ({ ...n, ntp_server: e.target.value })); setNtpDirty(true) }} />
                    <p className="text-xs text-gray-400 mt-1">es. <code>pool.ntp.org</code>, <code>ntp.inrim.it</code>, <code>time.windows.com</code></p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Fuso orario (IANA)</label>
                    <input className="input font-mono" placeholder="Europe/Rome"
                      value={ntp.timezone}
                      onChange={e => { setNtp(n => ({ ...n, timezone: e.target.value })); setNtpDirty(true) }} />
                    <p className="text-xs text-gray-400 mt-1">es. <code>Europe/Rome</code>, <code>UTC</code>, <code>America/New_York</code></p>
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button type="submit" disabled={ntpSaving || !ntpDirty}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50">
                    <Save size={14} />{ntpSaving ? 'Salvataggio...' : 'Salva'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Template modals */}
      {showCreateTemplate && (
        <Modal title="Nuovo Template" onClose={() => setShowCreateTemplate(false)}>
          <form onSubmit={handleCreateTemplate} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Nome *</label><input className="input" required value={templateForm.name} onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">Tipo</label>
                <select className="input" value={templateForm.type} onChange={e => setTemplateForm(f => ({ ...f, type: e.target.value }))}>
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select></div>
              <div><label className="block text-sm font-medium mb-1">Impatto</label>
                <select className="input" value={templateForm.impact_level} onChange={e => setTemplateForm(f => ({ ...f, impact_level: e.target.value }))}>
                  {IMPACTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select></div>
            </div>
            <div><label className="block text-sm font-medium mb-1">Durata (min)</label><input className="input" type="number" min="1" value={templateForm.duration_minutes} onChange={e => setTemplateForm(f => ({ ...f, duration_minutes: parseInt(e.target.value) }))} /></div>
            <div><label className="block text-sm font-medium mb-1">Descrizione</label><textarea className="input" rows={2} value={templateForm.description} onChange={e => setTemplateForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreateTemplate(false)}>Annulla</button>
              <button type="submit" className="btn-primary">Crea</button>
            </div>
          </form>
        </Modal>
      )}
      {deleteTargetTemplate && (
        <ConfirmDialog title="Elimina Template" message={`Eliminare "${deleteTargetTemplate.name}"?`} danger confirmLabel="Elimina"
          onConfirm={handleDeleteTemplate} onCancel={() => setDeleteTargetTemplate(null)} />
      )}

      {/* API Keys modals */}
      {showCreateKey && (
        <Modal title="Nuova API Key" onClose={() => setShowCreateKey(false)} size="sm">
          <form onSubmit={handleCreateKey} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Nome *</label><input className="input" required value={keyForm.name} onChange={e => setKeyForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">Scadenza (opzionale)</label><input type="datetime-local" className="input" value={keyForm.expires_at} onChange={e => setKeyForm(f => ({ ...f, expires_at: e.target.value }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreateKey(false)}>Annulla</button>
              <button type="submit" className="btn-primary">Crea</button>
            </div>
          </form>
        </Modal>
      )}
      {newKey && (
        <Modal title="Chiave creata" onClose={() => setNewKey(null)} size="sm">
          <p className="text-sm text-gray-600 mb-3">Copia questa chiave — non sarà più visualizzabile.</p>
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border">
            <code className="flex-1 text-xs break-all">{newKey}</code>
            <button onClick={() => { navigator.clipboard.writeText(newKey); toast.success('Copiata') }}><Copy size={16} /></button>
          </div>
          <div className="flex justify-end mt-4">
            <button className="btn-primary" onClick={() => setNewKey(null)}>Ho salvato la chiave</button>
          </div>
        </Modal>
      )}
      {deleteTargetKey && (
        <ConfirmDialog title="Elimina Chiave" message={`Eliminare "${deleteTargetKey.name}"?`} danger confirmLabel="Elimina"
          onConfirm={handleDeleteKey} onCancel={() => setDeleteTargetKey(null)} />
      )}
    </Layout>
  )
}
