import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { toast } from '../components/Toast'
import { incidentsApi } from '../api'
import { format } from 'date-fns'
import { ArrowLeft, Pencil, Save, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const STATUSES = ['investigating','identified','monitoring','resolved']
const SEVERITIES = ['critical','high','medium','low']

export default function IncidentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const [incident, setIncident] = useState(null)
  const [updateForm, setUpdateForm] = useState({ status: 'investigating', message: '' })
  const [posting, setPosting] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = () => incidentsApi.get(id).then(r => { setIncident(r.data); setUpdateForm(f => ({ ...f, status: r.data.status })) }).catch(() => navigate('/incidents'))
  useEffect(() => { load() }, [id])

  const handleUpdate = async (e) => {
    e.preventDefault()
    setPosting(true)
    try {
      await incidentsApi.addUpdate(id, updateForm)
      toast.success('Update added')
      setUpdateForm(f => ({ ...f, message: '' }))
      load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
    finally { setPosting(false) }
  }

  const enterEdit = () => {
    if (!incident) return
    setEditForm({ title: incident.title || '', severity: incident.severity || 'medium', description: incident.description || '' })
    setEditMode(true)
  }

  const cancelEdit = () => { setEditMode(false); setEditForm(null) }

  const saveEdit = async () => {
    if (!editForm.title.trim()) { toast.error('Title is required'); return }
    setSaving(true)
    try {
      await incidentsApi.update(id, editForm)
      toast.success('Incident updated')
      setEditMode(false); setEditForm(null); load()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
    finally { setSaving(false) }
  }

  if (!incident) return <Layout title="Incident"><div className="text-center py-16 text-gray-500">Loading...</div></Layout>

  const canEdit = hasRole('superadmin','admin')

  return (
    <Layout title={incident.title}>
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <Link to="/incidents" className="flex items-center gap-1 text-gray-500 hover:text-gray-700 text-sm"><ArrowLeft size={16} />Incidents</Link>
          <div className="flex gap-2">
            {!editMode && canEdit && <button className="btn-secondary flex items-center gap-1" onClick={enterEdit}><Pencil size={14} />Edit</button>}
            {editMode && (
              <>
                <button className="btn-secondary flex items-center gap-1" onClick={cancelEdit} disabled={saving}><X size={14} />Cancel</button>
                <button className="btn-primary flex items-center gap-1" onClick={saveEdit} disabled={saving}><Save size={14} />{saving ? 'Saving...' : 'Save'}</button>
              </>
            )}
          </div>
        </div>

        {editMode && editForm ? (
          <div className="card p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title *</label>
              <input className="input" value={editForm.title} onChange={e => setEditForm(f => ({...f, title: e.target.value}))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Severity</label>
              <select className="input" value={editForm.severity} onChange={e => setEditForm(f => ({...f, severity: e.target.value}))}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input" rows={3} value={editForm.description} onChange={e => setEditForm(f => ({...f, description: e.target.value}))} />
            </div>
          </div>
        ) : (
          <div className="card p-6 space-y-3">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={incident.status} />
              <CriticalityBadge criticality={incident.severity} />
            </div>
            <p className="text-gray-600 dark:text-gray-300 text-sm">{incident.description}</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Opened:</span> <strong>{format(new Date(incident.started_at), 'MM/dd/yyyy HH:mm')}</strong></div>
              {incident.resolved_at && <div><span className="text-gray-500">Resolved:</span> <strong>{format(new Date(incident.resolved_at), 'MM/dd/yyyy HH:mm')}</strong></div>}
            </div>
          </div>
        )}

        {/* Assets */}
        {incident.assets?.length > 0 && (
          <div className="card p-5">
            <h3 className="font-medium mb-3 text-sm">Affected assets</h3>
            <div className="flex flex-wrap gap-2">
              {incident.assets.map(a => <Link key={a.id} to={`/assets/${a.id}`} className="text-sm text-brand-600 hover:underline">{a.name}</Link>)}
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="card p-5">
          <h3 className="font-medium mb-4">Update timeline</h3>
          <div className="space-y-4">
            {incident.updates?.map(u => (
              <div key={u.id} className="flex gap-3">
                <div className="w-2 h-2 rounded-full bg-brand-500 mt-2 shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge status={u.status} />
                    <span className="text-xs text-gray-400">{format(new Date(u.created_at), 'MM/dd HH:mm')} · {u.author || '—'}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{u.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Add update */}
        {incident.status !== 'resolved' && (
          <div className="card p-5">
            <h3 className="font-medium mb-4 text-sm">Add update</h3>
            <form onSubmit={handleUpdate} className="space-y-3">
              <select className="input" value={updateForm.status} onChange={e => setUpdateForm(f => ({ ...f, status: e.target.value }))}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <textarea className="input" rows={3} required placeholder="Message..." value={updateForm.message}
                onChange={e => setUpdateForm(f => ({ ...f, message: e.target.value }))} />
              <div className="flex justify-end">
                <button type="submit" disabled={posting} className="btn-primary">{posting ? 'Sending...' : 'Publish'}</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  )
}


