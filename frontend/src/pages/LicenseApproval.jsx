import { useMemo, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { licensesApi } from '../api'

export default function LicenseApproval() {
  const [searchParams] = useSearchParams()
  const token = useMemo(() => (searchParams.get('token') || '').trim(), [searchParams])

  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [reason, setReason] = useState('')

  const load = async () => {
    if (!token) {
      setError('Missing approval token')
      return
    }
    setLoading(true)
    setError('')
    setResult('')
    try {
      const r = await licensesApi.approvalInfo(token)
      setInfo(r.data)
    } catch (err) {
      setInfo(null)
      setError(err.response?.data?.error || 'Cannot load approval request')
    } finally {
      setLoading(false)
    }
  }

  const approve = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await licensesApi.approvalApprove(token)
      setResult(r.data?.message || 'License approved')
      await load()
    } catch (err) {
      setError(err.response?.data?.error || 'Approval failed')
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await licensesApi.approvalReject(token, reason)
      setResult(r.data?.message || 'License rejected')
      await load()
    } catch (err) {
      setError(err.response?.data?.error || 'Reject failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-4 sm:p-8">
      <div className="max-w-xl mx-auto card p-6 sm:p-8 space-y-4">
        <h1 className="text-xl font-semibold">License Approval</h1>

        {!info && !loading && (
          <button className="btn-primary" onClick={load}>Load request</button>
        )}

        {loading && <p className="text-sm text-gray-500">Loading...</p>}

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
        {result && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">{result}</div>}

        {info && (
          <div className="space-y-3">
            <div className="text-sm"><span className="text-gray-500">License:</span> <strong>{info.name}</strong></div>
            <div className="text-sm"><span className="text-gray-500">Supplier:</span> {info.supplier_company || '—'}</div>
            <div className="text-sm"><span className="text-gray-500">Expiry:</span> {info.expiry_date ? String(info.expiry_date).slice(0, 10) : '—'}</div>
            <div className="text-sm"><span className="text-gray-500">Status:</span> {info.approval_status}</div>
            <div className="text-sm"><span className="text-gray-500">Link expires:</span> {info.expires_at ? new Date(info.expires_at).toLocaleString() : '—'}</div>

            <div>
              <label className="block text-sm font-medium mb-1">Reject reason (optional)</label>
              <textarea className="input" rows={3} value={reason} onChange={e => setReason(e.target.value)} />
            </div>

            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={busy} onClick={approve}>Approve</button>
              <button className="btn-secondary" disabled={busy} onClick={reject}>Reject</button>
              <button className="btn-secondary" disabled={busy} onClick={load}>Refresh</button>
            </div>
          </div>
        )}

        <div className="pt-2 text-sm">
          <Link to="/login" className="text-brand-600 hover:underline">Back to login</Link>
        </div>
      </div>
    </div>
  )
}
