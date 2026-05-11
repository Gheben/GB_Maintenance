import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { settingsApi } from '../api'
import { toast } from '../components/Toast'
import { Copy, ExternalLink, Shield, Save, CheckCircle, AlertCircle } from 'lucide-react'

function Section({ title, children }) {
  return (
    <div className="card p-6 space-y-4">
      <h2 className="font-semibold text-base border-b border-gray-100 dark:border-gray-700 pb-2">{title}</h2>
      {children}
    </div>
  )
}

export default function Settings() {
  const [tab, setTab] = useState('smtp')
  const [smtp, setSmtp] = useState({ host: '', port: 587, secure: false, user: '', pass: '', from: '' })
  const [ldap, setLdap] = useState({ url: '', base_dn: '', bind_dn: '', bind_password: '', user_filter: '', username_attr: 'sAMAccountName' })
  const [saml, setSaml] = useState({
    enabled: false, auto_redirect: false, require_group_match: false,
    sp_base_url: window.location.origin, sp_entity_id: '',
    idp_sso_url: '', idp_slo_url: '', idp_cert: '',
    sp_private_key: '', sp_cert: '',
    username_attribute: '', display_name_attribute: 'displayName',
    email_attribute: 'email', default_role: 'viewer',
  })
  const [general, setGeneral] = useState({ app_name: 'GB Maintenance', app_url: '' })
  const [webhooks, setWebhooks] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    settingsApi.getSmtp().then(r => setSmtp(r.data)).catch(() => {})
    settingsApi.getLdap().then(r => setLdap(prev => ({ ...prev, ...r.data }))).catch(() => {})
    settingsApi.getSaml().then(r => setSaml(prev => ({ ...prev, ...r.data }))).catch(() => {})
    settingsApi.getGeneral().then(r => setGeneral(r.data)).catch(() => {})
    settingsApi.getWebhooks().then(r => setWebhooks(r.data)).catch(() => {})
  }, [])

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
    try { await settingsApi.saveLdap(ldap); toast.success('LDAP salvato') }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
    finally { setLoading(false) }
  }

  const saveGeneral = async (e) => {
    e.preventDefault()
    try { await settingsApi.saveGeneral(general); toast.success('Impostazioni salvate') }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const saveSaml = async (e) => {
    e.preventDefault(); setLoading(true)
    try { await settingsApi.saveSaml(saml); toast.success('Configurazione SAML salvata') }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
    finally { setLoading(false) }
  }

  const spBaseUrl = saml.sp_base_url || window.location.origin

  const TABS = [['smtp','SMTP'],['ldap','LDAP'],['saml','SAML'],['webhooks','Webhook'],['general','Generale']]

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
          <Section title="Configurazione LDAP">
            <form onSubmit={saveLdap} className="space-y-3">
              <div><label className="block text-xs font-medium mb-1">URL LDAP *</label><input className="input" placeholder="ldap://dc.example.com:389" value={ldap.url || ''} onChange={e => setLdap(f => ({ ...f, url: e.target.value }))} /></div>
              <div><label className="block text-xs font-medium mb-1">Base DN *</label><input className="input" placeholder="DC=example,DC=com" value={ldap.base_dn || ''} onChange={e => setLdap(f => ({ ...f, base_dn: e.target.value }))} /></div>
              <div><label className="block text-xs font-medium mb-1">Bind DN</label><input className="input" value={ldap.bind_dn || ''} onChange={e => setLdap(f => ({ ...f, bind_dn: e.target.value }))} /></div>
              <div><label className="block text-xs font-medium mb-1">Bind Password</label><input className="input" type="password" placeholder="••••••••" value={ldap.bind_password === '********' ? '' : ldap.bind_password || ''} onChange={e => setLdap(f => ({ ...f, bind_password: e.target.value }))} /></div>
              <div><label className="block text-xs font-medium mb-1">User filter</label><input className="input" placeholder="(objectClass=person)" value={ldap.user_filter || ''} onChange={e => setLdap(f => ({ ...f, user_filter: e.target.value }))} /></div>
              <div className="flex gap-3 pt-2">
                <button type="button" className="btn-secondary" onClick={async () => {
                  try { await settingsApi.testLdap(ldap); toast.success('LDAP OK') }
                  catch (err) { toast.error(err.response?.data?.error || 'Test fallito') }
                }}>Test</button>
                <button type="submit" className="btn-primary" disabled={loading}>Salva</button>
              </div>
            </form>
          </Section>
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

        {tab === 'webhooks' && (
          <Section title="Webhook">
            <p className="text-sm text-gray-500 mb-2">Aggiungi endpoint per ricevere notifiche via webhook (Teams, Slack, custom).</p>
            {webhooks.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className="input flex-1" placeholder="URL webhook" value={w.url || ''} onChange={e => setWebhooks(wh => { const a = [...wh]; a[i] = { ...a[i], url: e.target.value }; return a })} />
                <select className="input w-32" value={w.type || 'generic'} onChange={e => setWebhooks(wh => { const a = [...wh]; a[i] = { ...a[i], type: e.target.value }; return a })}>
                  {['generic','teams','slack'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button className="btn-danger py-2 px-2" onClick={() => setWebhooks(wh => wh.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <div className="flex gap-3 pt-1">
              <button className="btn-secondary" onClick={() => setWebhooks(w => [...w, { url: '', type: 'generic' }])}>+ Aggiungi</button>
              <button className="btn-primary" onClick={async () => { await settingsApi.saveWebhooks(webhooks); toast.success('Webhook salvati') }}>Salva</button>
            </div>
          </Section>
        )}

        {tab === 'general' && (
          <Section title="Impostazioni generali">
            <form onSubmit={saveGeneral} className="space-y-3">
              <div><label className="block text-xs font-medium mb-1">Nome applicazione</label><input className="input" value={general.app_name || ''} onChange={e => setGeneral(f => ({ ...f, app_name: e.target.value }))} /></div>
              <div><label className="block text-xs font-medium mb-1">URL applicazione</label><input className="input" placeholder="https://maintenance.example.com" value={general.app_url || ''} onChange={e => setGeneral(f => ({ ...f, app_url: e.target.value }))} /></div>
              <div className="flex justify-end pt-2">
                <button type="submit" className="btn-primary">Salva</button>
              </div>
            </form>
          </Section>
        )}
      </div>
    </Layout>
  )
}
