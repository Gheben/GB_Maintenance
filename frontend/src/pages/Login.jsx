import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Wrench, Eye, EyeOff, Coffee } from 'lucide-react'
import { toast } from '../components/Toast'
import { settingsApi, reportsApi, maintenanceApi, assetsApi, servicesApi, notificationsApi } from '../api'

let warmupDone = false

function warmupAfterLogin() {
  if (warmupDone) return
  warmupDone = true

  // Warm up route chunks so first navigation feels instant.
  Promise.allSettled([
    import('./Dashboard'),
    import('./Assets'),
    import('./Services'),
    import('./Maintenance'),
    import('./Incidents'),
    import('./Users'),
    import('./Licenses'),
  ]).catch(() => {})

  // Warm up key API payloads used by landing/primary sections.
  Promise.allSettled([
    reportsApi.dashboard(),
    maintenanceApi.list({ page: 1, limit: 20 }),
    assetsApi.list({ page: 1, limit: 20 }),
    servicesApi.list({ page: 1, limit: 20 }),
    notificationsApi.list({ page: 1, limit: 20 }),
  ]).catch(() => {})
}

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({ username: '', password: '', totp_code: '' })
  const [needTotp, setNeedTotp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [branding, setBranding] = useState({ app_name: 'GB Maintenance', app_brand_image_url: '' })

  useEffect(() => {
    settingsApi.publicBranding()
      .then(r => {
        const b = r.data || {}
        setBranding({
          app_name: b.app_name || 'GB Maintenance',
          app_brand_image_url: b.app_brand_image_url || '',
        })
      })
      .catch(() => {})
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = { username: form.username, password: form.password }
      if (needTotp) {
        payload.totp_token = form.totp_code
        payload.totp_code = form.totp_code
      }
      const result = await login(payload)
      if (result.totp_required) { setNeedTotp(true); setLoading(false); return }
      warmupAfterLogin()
      navigate('/', { replace: true })
    } catch (err) {
      toast.error(err.response?.data?.error || 'Credenziali non valide')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-slate-800 to-slate-900 dark:from-black dark:via-gray-950 dark:to-black p-4 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-blue-500/10 rounded-full mix-blend-screen filter blur-3xl animate-pulse"></div>
        <div className="absolute bottom-20 right-10 w-72 h-72 bg-purple-500/10 rounded-full mix-blend-screen filter blur-3xl animate-pulse" style={{animationDelay: '2s'}}></div>
      </div>

      <div className="w-full max-w-sm relative z-10">
        <div className="card border border-slate-700 shadow-2xl backdrop-blur-sm bg-slate-800/50 dark:bg-slate-900/70 p-8">
          <div className="flex items-center gap-2 mb-8 justify-center">
            {branding.app_brand_image_url ? (
              <img src={branding.app_brand_image_url} alt={branding.app_name} className="w-8 h-8 object-contain rounded" />
            ) : (
              <Wrench size={28} className="text-brand-400" />
            )}
            <span className="text-2xl font-bold text-slate-100">{branding.app_name || 'GB Maintenance'}</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!needTotp ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-100 mb-1">Username</label>
                  <input className="input bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400 focus:border-brand-400 focus:ring-brand-400/50" autoFocus value={form.username}
                    onChange={e => set('username', e.target.value)} required autoComplete="username" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-100 mb-1">Password</label>
                  <div className="relative">
                    <input className="input bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400 pr-10 focus:border-brand-400 focus:ring-brand-400/50" type={showPass ? 'text' : 'password'}
                      value={form.password} onChange={e => set('password', e.target.value)}
                      required autoComplete="current-password" />
                    <button type="button" className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 transition-colors"
                      onClick={() => setShowPass(!showPass)}>
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-sm font-medium text-slate-100 mb-1">Codice TOTP</label>
                <input className="input bg-slate-700 border-slate-600 text-slate-100 placeholder-slate-400 text-center text-2xl tracking-widest focus:border-brand-400 focus:ring-brand-400/50" maxLength={6}
                  value={form.totp_code} onChange={e => set('totp_code', e.target.value)}
                  autoFocus required placeholder="000000" />
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center mt-2 bg-brand-600 hover:bg-brand-700 text-white shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-0.5">
              {loading ? 'Accesso...' : needTotp ? 'Verifica' : 'Accedi'}
            </button>

            {needTotp && (
              <button type="button" className="text-xs text-slate-400 hover:text-slate-200 w-full text-center transition-colors"
                onClick={() => setNeedTotp(false)}>← Torna al login</button>
            )}
          </form>

          <div className="mt-4 border-t border-slate-700 pt-4">
            <a href="/api/auth/saml/login"
              className="block w-full px-4 py-2 rounded-lg text-center text-slate-100 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 hover:border-slate-500 transition-all transform hover:-translate-y-0.5 shadow-md"
            >
              Accedi con SSO / SAML
            </a>
          </div>
        </div>

        {/* Footer with donation links */}
        <p className="mt-8 text-slate-400 text-xs text-center">
          &copy; {new Date().getFullYear()} Powered by{' '}
          <span className="text-slate-200 font-semibold">Guido Ballarini</span>
        </p>
        <div className="mt-2 flex items-center justify-center gap-4">
          <a href="https://buymeacoffee.com/guidoballau" target="_blank" rel="noreferrer"
            title="Buy me a coffee"
            className="text-slate-500 hover:text-amber-300 transition-colors transform hover:scale-125 duration-200">
            <Coffee size={15} />
          </a>
          <a href="https://www.paypal.com/donate/?hosted_button_id=8RF28JBPLYASN" target="_blank" rel="noreferrer"
            title="Donate via PayPal"
            className="text-slate-500 hover:text-blue-400 transition-colors transform hover:scale-125 duration-200">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788.06-.26.76-4.852.816-5.09a.932.932 0 0 1 .923-.788h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.471z" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  )
}
