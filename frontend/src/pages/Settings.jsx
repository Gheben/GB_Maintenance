import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { settingsApi } from '../api'
import { toast } from '../components/Toast'

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
  const [general, setGeneral] = useState({ app_name: 'GB Maintenance', app_url: '' })
  const [webhooks, setWebhooks] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    settingsApi.getSmtp().then(r => setSmtp(r.data)).catch(() => {})
    settingsApi.getLdap().then(r => setLdap(prev => ({ ...prev, ...r.data }))).catch(() => {})
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
          <Section title="Configurazione SAML">
            <p className="text-sm text-gray-500">Configurazione SAML disponibile tramite API oppure importando il metadata XML dell'IdP.</p>
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
