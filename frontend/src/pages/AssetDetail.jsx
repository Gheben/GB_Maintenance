import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { assetsApi } from '../api'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { Trash2, Play, ArrowLeft } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function AssetDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const [asset, setAsset] = useState(null)
  const [probes, setProbes] = useState([])
  const [maintenance, setMaintenance] = useState([])
  const [tab, setTab] = useState('info')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [probing, setProbing] = useState(false)

  useEffect(() => {
    assetsApi.get(id).then(r => setAsset(r.data)).catch(() => navigate('/assets'))
    assetsApi.probes(id, { limit: 20 }).then(r => setProbes(r.data))
    assetsApi.maintenance(id).then(r => setMaintenance(r.data))
  }, [id])

  const handleProbeNow = async () => {
    setProbing(true)
    try {
      await assetsApi.probeNow(id)
      toast.success('Probe avviato')
      const r = await assetsApi.probes(id, { limit: 20 })
      setProbes(r.data)
      const ar = await assetsApi.get(id)
      setAsset(ar.data)
    } catch (err) { toast.error('Errore probe') }
    finally { setProbing(false) }
  }

  const handleDelete = async () => {
    try { await assetsApi.delete(id); toast.success('Asset eliminato'); navigate('/assets') }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  if (!asset) return <Layout title="Asset"><div className="text-center py-16 text-gray-500">Caricamento...</div></Layout>

  return (
    <Layout title={asset.name}>
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link to="/assets" className="flex items-center gap-1 text-gray-500 hover:text-gray-700 text-sm"><ArrowLeft size={16} />Asset</Link>
          <div className="flex gap-2">
            {asset.probe_enabled && <button className="btn-secondary" disabled={probing} onClick={handleProbeNow}><Play size={14} />{probing ? 'Probe...' : 'Probe ora'}</button>}
            {hasRole('superadmin','admin') && <button className="btn-danger" onClick={() => setDeleteConfirm(true)}><Trash2 size={14} />Elimina</button>}
          </div>
        </div>

        {/* Info card */}
        <div className="card p-6">
          <div className="flex flex-wrap gap-3 mb-4">
            <StatusBadge status={asset.status} />
            <CriticalityBadge criticality={asset.criticality} />
            <span className="badge bg-gray-100 text-gray-700">{asset.category}</span>
          </div>
          <p className="text-gray-600 dark:text-gray-300">{asset.description || 'Nessuna descrizione'}</p>

          {asset.probe_enabled && (
            <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
              <strong>Probe:</strong> {asset.probe_type} → {asset.probe_url} | Intervallo: {asset.probe_interval_seconds}s
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {['Dipendenze','Probe history','Manutenzioni'].map((t, i) => {
            const key = ['deps','probes','maintenance'][i]
            return <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium ${tab === key ? 'border-b-2 border-brand-600 text-brand-600' : 'text-gray-500 hover:text-gray-700'}`}>{t}</button>
          })}
        </div>

        {tab === 'deps' && (
          <div className="card p-5">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium mb-3 text-sm">Dipende da</h3>
                {asset.depends_on?.length === 0 && <p className="text-gray-500 text-sm">Nessuna dipendenza</p>}
                {asset.depends_on?.map(a => <Link key={a.id} to={`/assets/${a.id}`} className="block text-sm text-brand-600 hover:underline">{a.name}</Link>)}
              </div>
              <div>
                <h3 className="font-medium mb-3 text-sm">Richiesto da</h3>
                {asset.required_by?.length === 0 && <p className="text-gray-500 text-sm">Nessuno</p>}
                {asset.required_by?.map(a => <Link key={a.id} to={`/assets/${a.id}`} className="block text-sm text-brand-600 hover:underline">{a.name}</Link>)}
              </div>
            </div>
          </div>
        )}

        {tab === 'probes' && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>{['Esito','Resp. ms','Status','Data'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {probes.map(p => (
                  <tr key={p.id}>
                    <td className="px-4 py-2">{p.success ? '✅' : '❌'}</td>
                    <td className="px-4 py-2">{p.response_time_ms ?? '—'}</td>
                    <td className="px-4 py-2">{p.status_code ?? p.error_message ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-500">{format(new Date(p.probed_at), 'dd/MM HH:mm:ss', { locale: it })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'maintenance' && (
          <div className="space-y-2">
            {maintenance.length === 0 && <p className="text-gray-500 text-sm">Nessuna manutenzione registrata</p>}
            {maintenance.map(m => (
              <Link key={m.id} to={`/maintenance/${m.id}`} className="card p-4 flex items-center justify-between hover:border-brand-300">
                <div>
                  <p className="font-medium text-sm">{m.title}</p>
                  <p className="text-xs text-gray-500">{format(new Date(m.scheduled_start), 'dd MMM yyyy HH:mm', { locale: it })}</p>
                </div>
                <StatusBadge status={m.status} />
              </Link>
            ))}
          </div>
        )}
      </div>

      {deleteConfirm && (
        <ConfirmDialog title="Elimina Asset" message={`Eliminare "${asset.name}"?`} danger confirmLabel="Elimina"
          onConfirm={handleDelete} onCancel={() => setDeleteConfirm(false)} />
      )}
    </Layout>
  )
}
