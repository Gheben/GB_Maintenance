import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { StatusBadge, CriticalityBadge } from '../components/StatusBadge'
import { toast } from '../components/Toast'
import { incidentsApi, incidentSeveritiesApi } from '../api'
import { format } from 'date-fns'
import { ArrowLeft, Pencil, Save, X, ShieldCheck } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const STATUSES = ['investigating','identified','monitoring','resolved']
const SEVERITIES = ['critical','high','medium','low']
const TABS = [['info','Info'],['affected','Affected'],['users','Users'],['timeline','Timeline']]

export default function IncidentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { hasRole } = useAuth()
  const [incident, setIncident] = useState(null)
  const [tab, setTab] = useState('info')
  const [incidentUsers, setIncidentUsers] = useState([])
  const [impactedOffices, setImpactedOffices] = useState([])
  const [selectedOffice, setSelectedOffice] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [userLimit, setUserLimit] = useState(25)
  const [updateForm, setUpdateForm] = useState({ status: 'investigating', message: '' })
  const [posting, setPosting] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [severityDefs, setSeverityDefs] = useState([])

  const load = () => incidentsApi.get(id).then(r => { setIncident(r.data); setUpdateForm(f => ({ ...f, status: r.data.status })) }).catch(() => navigate('/incidents'))
  useEffect(() => { load() }, [id])

  useEffect(() => {
    if (tab === 'users') {
      incidentsApi.users(id)
        .then((r) => {
          const payload = r.data
          if (Array.isArray(payload)) {
            setIncidentUsers(payload)
            const offices = [...new Set(payload.map((u) => String(u.office || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
            setImpactedOffices(offices)
            return
          }
          setIncidentUsers(Array.isArray(payload?.users) ? payload.users : [])
          setImpactedOffices(Array.isArray(payload?.offices_impacted) ? payload.offices_impacted : [])
        })
        .catch(() => {})
    }
  }, [tab, id])

  useEffect(() => {
    incidentSeveritiesApi.list()
      .then((r) => setSeverityDefs(Array.isArray(r.data) ? r.data : []))
      .catch(() => setSeverityDefs([]))
  }, [])

  const severityOptions = severityDefs.length > 0 ? severityDefs.map((s) => s.slug) : SEVERITIES
  const severityLabel = (slug) => {
    const found = severityDefs.find((s) => s.slug === slug)
    return found?.label || slug
  }

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
  const relatedAssets = (incident.affectedAssets || []).filter((asset) => !asset.is_direct)

  const q = userSearch.toLowerCase()
  const filteredUsers = incidentUsers.filter((u) => {
    const matchesSearch = !q ||
      (u.display_name||'').toLowerCase().includes(q) ||
      (u.username||'').toLowerCase().includes(q) ||
      (u.email||'').toLowerCase().includes(q)
    const matchesOffice = !selectedOffice || String(u.office || '').trim() === selectedOffice
    return matchesSearch && matchesOffice
  })
  const visibleUsers = filteredUsers.slice(0, userLimit)

  return (
    <Layout title={incident.title}>
      <div className="space-y-6">
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

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {TABS.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === key ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Info tab */}
        {tab === 'info' && (editMode && editForm ? (
          <div className="card p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title *</label>
              <input className="input" value={editForm.title} onChange={e => setEditForm(f => ({...f, title: e.target.value}))} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Severity</label>
              <select className="input" value={editForm.severity} onChange={e => setEditForm(f => ({...f, severity: e.target.value}))}>
                {severityOptions.map(s => <option key={s} value={s}>{severityLabel(s)}</option>)}
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
        ))}

        {/* Affected tab */}
        {tab === 'affected' && (
          <div className="card p-5 space-y-4">
            <div>
              <h3 className="font-medium mb-3 text-sm">Selected assets</h3>
              {incident.assets?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {incident.assets.map(a => (
                  <Link key={a.id} to={`/assets/${a.id}`} className="inline-flex items-center gap-1 text-sm text-brand-600 hover:underline">
                    {a.part_is_relevant && <ShieldCheck size={14} className="text-amber-600" title="Part-IS Relevant" />}
                    {a.name}
                  </Link>
                ))}
              </div>
            ) : (
                <p className="text-gray-500 text-sm">No selected assets</p>
            )}
            </div>
            {relatedAssets.length > 0 && (
              <div>
                <h3 className="font-medium mb-3 text-sm">Related affected assets</h3>
                <div className="flex flex-wrap gap-2">
                  {relatedAssets.map((asset) => (
                    <Link key={asset.id} to={`/assets/${asset.id}`} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline dark:text-gray-300">
                      {asset.part_is_relevant && <ShieldCheck size={14} className="text-amber-600" title="Part-IS Relevant" />}
                      {asset.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Users tab */}
        {tab === 'users' && (
          <div className="card overflow-hidden">
            <div className="p-3 border-b border-gray-100 dark:border-gray-700">
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Offices impacted ({impactedOffices.length})</p>
                {impactedOffices.length === 0 ? (
                  <p className="text-xs text-gray-400">No office data available</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => { setSelectedOffice(''); setUserLimit(25) }}
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs border ${selectedOffice === '' ? 'bg-brand-100 text-brand-700 border-brand-200' : 'bg-white text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'}`}
                    >
                      All offices
                    </button>
                    {impactedOffices.map((office) => (
                      <button
                        type="button"
                        key={office}
                        onClick={() => { setSelectedOffice(office); setUserLimit(25) }}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${selectedOffice === office ? 'bg-indigo-200 text-indigo-900 dark:bg-indigo-700/60 dark:text-indigo-100' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'}`}
                      >
                        {office}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input className="input text-sm" placeholder="Search users..."
                value={userSearch} onChange={e => { setUserSearch(e.target.value); setUserLimit(25) }} />
            </div>
            {filteredUsers.length === 0 ? (
              <p className="text-gray-500 text-sm p-5 text-center">No users impacted by this incident.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50">
                  <tr>{['Display Name','Username','Email','Office','Role','Auth'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {visibleUsers.map(u => (
                    <tr key={u.id}>
                      <td className="px-4 py-2 font-medium">{u.display_name || u.username}</td>
                      <td className="px-4 py-2 text-gray-500">{u.username}</td>
                      <td className="px-4 py-2 text-gray-500">{u.email || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{u.office || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{u.role}</td>
                      <td className="px-4 py-2"><span className={`px-1.5 py-0.5 rounded text-xs font-bold ${u.auth_type === 'ldap' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{u.auth_type || 'local'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {filteredUsers.length > userLimit && (
              <div className="p-3 text-center border-t border-gray-100">
                <button className="text-sm text-brand-600 hover:underline" onClick={() => setUserLimit(l => l + 25)}>
                  Show {filteredUsers.length - userLimit} more
                </button>
              </div>
            )}
          </div>
        )}

        {/* Timeline tab */}
        {tab === 'timeline' && (
          <>
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
          </>
        )}
      </div>
    </Layout>
  )
}
