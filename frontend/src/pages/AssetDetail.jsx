import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { assetsApi } from '../api'
import { format } from 'date-fns'
import { Trash2, Play, ArrowLeft, Pencil, Save, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const CATEGORIES = ['hardware','software','network','virtual','cloud','other']
const CRITICALITIES = ['critical','high','medium','low']

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
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = () => {
    assetsApi.get(id).then(r => setAsset(r.data)).catch(() => navigate('/assets'))
    assetsApi.probes(id, { limit: 20 }).then(r => setProbes(r.data))
    assetsApi.maintenance(id).then(r => setMaintenance(r.data))
  }
  useEffect(() => { load() }, [id])

  const handleProbeNow = async () => {
    setProbing(true)
    try {
      await assetsApi.probeNow(id)
      toast.success('Probe started')
      const r = await assetsApi.probes(id, { limit: 20 })
      setProbes(r.data)
      const ar = await assetsApi.get(id)
      setAsset(ar.data)
    } catch (err) { toast.error('Probe error') }
    finally { setProbing(false) }
  }

  const handleDelete = async () => {
    try { await assetsApi.delete(id); toast.success('Asset deleted'); navigate('/assets') }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const enterEdit = () => {
    if (!asset) return
    setEditForm({ name: asset.name || '', category: asset.category || 'hardware', criticality: asset.criticality || 'medium', description: asset.description || '' })
    setEditMode(true)
  }

  const cancelEdit = () => { setEditMode(false); setEditForm(null) }

  const saveEdit = async () => {
    if (!editForm.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    try {
      await assetsApi.update(id, editForm)
      toast.success('Asset updated')
      setEditMode(false)
      setEditForm(null)
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
    finally { setSaving(false) }
  }

  if (!asset) return <Layout title="Asset"><div className="text-center py-16 text-gray-500">Loading...</div></Layout>

  const canEdit = hasRole('superadmin','admin')

  return (
    <Layout title={asset.name}>
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link to="/assets" className="flex items-center gap-1 text-gray-500 hover:text-gray-700 text-sm"><ArrowLeft size={16} />Assets</Link>
          <div className="flex gap-2">
            {!editMode && canEdit && <button className="btn-secondary flex items-center gap-1" onClick={enterEdit}><Pencil size={14} />Edit</button>}
            {editMode && (
              <>
                <button className="btn-secondary flex items-center gap-1" onClick={cancelEdit} disabled={saving}><X size={14} />Cancel</button>
                <button className="btn-primary flex items-center gap-1" onClick={saveEdit} disabled={saving}><Save size={14} />{saving ? 'Saving...' : 'Save'}</button>
              </>
            )}
            {!editMode && asset.probe_enabled && <button className="btn-secondary flex items-center gap-1" disabled={probing} onClick={handleProbeNow}><Play size={14} />{probing ? 'Probing...' : 'Probe now'}</button>}
            {!editMode && hasRole('superadmin','admin') && <button className="btn-danger flex items-center gap-1" onClick={() => setDeleteConfirm(true)}><Trash2 size={14} />Delete</button>}
          </div>
        </div>

        {editMode && editForm ? (
          <div className="card p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input className="input" value={editForm.name} onChange={e => setEditForm(f => ({...f, name: e.target.value}))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Category</label>
                <select className="input" value={editForm.category} onChange={e => setEditForm(f => ({...f, category: e.target.value}))}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Criticality</label>
                <select className="input" value={editForm.criticality} onChange={e => setEditForm(f => ({...f, criticality: e.target.value}))}>
                  {CRITICALITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input" rows={3} value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))} />
            </div>
          </div>
        ) : (
          /* Info card */
          <div className="card p-6">
            <div className="flex flex-wrap gap-3 mb-4">
              <StatusBadge status={asset.status} />
              <CriticalityBadge criticality={asset.criticality} />
              <span className="badge bg-gray-100 text-gray-700">{asset.category}</span>
            </div>
            <p className="text-gray-600 dark:text-gray-300">{asset.description || 'No description'}</p>
            {asset.probe_enabled && (
              <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
                <strong>Probe:</strong> {asset.probe_type} → {asset.probe_url} | Interval: {asset.probe_interval_seconds}s
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {['Dependencies','Probe history','Maintenances'].map((t, i) => {
            const key = ['deps','probes','maintenance'][i]
            return <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium ${tab === key ? 'border-b-2 border-brand-600 text-brand-600' : 'text-gray-500 hover:text-gray-700'}`}>{t}</button>
          })}
        </div>

        {tab === 'deps' && (
          <div className="card p-5">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="font-medium mb-3 text-sm">Depends on</h3>
                {asset.depends_on?.length === 0 && <p className="text-gray-500 text-sm">No dependencies</p>}
                {asset.depends_on?.map(a => <Link key={a.id} to={`/assets/${a.id}`} className="block text-sm text-brand-600 hover:underline">{a.name}</Link>)}
              </div>
              <div>
                <h3 className="font-medium mb-3 text-sm">Required by</h3>
                {asset.required_by?.length === 0 && <p className="text-gray-500 text-sm">None</p>}
                {asset.required_by?.map(a => <Link key={a.id} to={`/assets/${a.id}`} className="block text-sm text-brand-600 hover:underline">{a.name}</Link>)}
              </div>
            </div>
          </div>
        )}

        {tab === 'probes' && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>{['Result','Resp. ms','Status','Date'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {probes.map(p => (
                  <tr key={p.id}>
                    <td className="px-4 py-2">{p.success ? '✅' : '❌'}</td>
                    <td className="px-4 py-2">{p.response_time_ms ?? '—'}</td>
                    <td className="px-4 py-2">{p.status_code ?? p.error_message ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-500">{format(new Date(p.probed_at), 'MM/dd HH:mm:ss')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'maintenance' && (
          <div className="space-y-2">
            {maintenance.length === 0 && <p className="text-gray-500 text-sm">No maintenance records</p>}
            {maintenance.map(m => (
              <Link key={m.id} to={`/maintenance/${m.id}`} className="card p-4 flex items-center justify-between hover:border-brand-300">
                <div>
                  <p className="font-medium text-sm">{m.title}</p>
                  <p className="text-xs text-gray-500">{format(new Date(m.scheduled_start), 'MMM dd yyyy HH:mm')}</p>
                </div>
                <StatusBadge status={m.status} />
              </Link>
            ))}
          </div>
        )}
      </div>

      {deleteConfirm && (
        <ConfirmDialog title="Delete Asset" message={`Delete "${asset.name}"?`} danger confirmLabel="Delete"
          onConfirm={handleDelete} onCancel={() => setDeleteConfirm(false)} />
      )}
    </Layout>
  )
}


