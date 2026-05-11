import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Wrench, Eye, EyeOff } from 'lucide-react'
import { toast } from '../components/Toast'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/'

  const [form, setForm] = useState({ username: '', password: '', totp_code: '' })
  const [needTotp, setNeedTotp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = { username: form.username, password: form.password }
      if (needTotp) payload.totp_code = form.totp_code
      const result = await login(payload)
      if (result.totp_required) { setNeedTotp(true); setLoading(false); return }
      navigate(from, { replace: true })
    } catch (err) {
      toast.error(err.response?.data?.error || 'Credenziali non valide')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <div className="card w-full max-w-sm p-8">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <Wrench size={28} className="text-brand-600" />
          <span className="text-2xl font-bold">GB Maintenance</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!needTotp ? (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Username</label>
                <input className="input" autoFocus value={form.username}
                  onChange={e => set('username', e.target.value)} required autoComplete="username" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Password</label>
                <div className="relative">
                  <input className="input pr-10" type={showPass ? 'text' : 'password'}
                    value={form.password} onChange={e => set('password', e.target.value)}
                    required autoComplete="current-password" />
                  <button type="button" className="absolute right-3 top-2.5 text-gray-400"
                    onClick={() => setShowPass(!showPass)}>
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-1">Codice TOTP</label>
              <input className="input text-center text-2xl tracking-widest" maxLength={6}
                value={form.totp_code} onChange={e => set('totp_code', e.target.value)}
                autoFocus required placeholder="000000" />
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full justify-center mt-2">
            {loading ? 'Accesso...' : needTotp ? 'Verifica' : 'Accedi'}
          </button>

          {needTotp && (
            <button type="button" className="text-xs text-gray-500 w-full text-center hover:underline"
              onClick={() => setNeedTotp(false)}>← Torna al login</button>
          )}
        </form>

        <div className="mt-4 border-t border-gray-100 dark:border-gray-700 pt-4">
          <a href="/api/auth/saml/login"
            className="btn-secondary w-full justify-center text-center">
            Accedi con SSO / SAML
          </a>
        </div>
      </div>
    </div>
  )
}
