import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { templatesApi, notificationsApi } from '../api'
import { Modal, ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { Plus, Trash2, Pencil, Save, ChevronDown, ChevronRight, Eye } from 'lucide-react'

const TYPES = ['planned','emergency','upgrade','security_patch','infrastructure','other']
const IMPACTS = ['critical','high','medium','low']

const NOTIFY_GROUP_ORDER = ['maintenance', 'blackout']
const NOTIFY_GROUP_LABELS = {
  maintenance: 'Maintenance Notifications',
  blackout: 'Blackout Notifications',
}

const NOTIFY_SAMPLE_VARS = {
  title: 'Database Server Upgrade',
  type: 'planned',
  impact_level: 'high',
  scheduled_start: '12/05/2026 22:00',
  scheduled_end: '13/05/2026 02:00',
  actual_start: '12/05/2026 22:05',
  actual_end: '13/05/2026 01:47',
  description: 'Upgrade del motore PostgreSQL dalla versione 15 alla 16.',
  notes: 'Completato senza anomalie.',
  primary_assets: 'Core Database Server',
  affected_assets: 'Core Database Server, Customer Portal, Reporting API',
  time_before: '2 ore',
  reason: 'Slot riprogrammato su richiesta del fornitore.',
  reopened_at: '13/05/2026 09:00',
  reopen_reason: 'Rilevata anomalia residua post-manutenzione.',
  owner_source_type: 'asset',
  owner_source_name: 'Core Database Server',
  created_by_name: 'M. Rossi',
  owner_name: 'A. Bianchi',
  proposed_start: '14/05/2026 22:00',
  proposed_end: '15/05/2026 02:00',
  response_note: 'Preferirei posticipare di un giorno.',
  creator_proposed_start: '15/05/2026 22:00',
  creator_proposed_end: '16/05/2026 02:00',
  creator_response_note: 'Va bene il giorno dopo.',
  approval_url: `${window.location.origin}/maintenance/approval?token=demo-token`,
  name: 'Change freeze - Q3 closing',
  start_date: '20/05/2026',
  end_date: '25/05/2026',
  id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  app_url: window.location.origin,
}

const NOTIFY_TPL_VARS = {
  maintenance_scheduled: ['title','type','impact_level','scheduled_start','scheduled_end','description','primary_assets','affected_assets','id','app_url'],
  maintenance_reminder: ['title','time_before','scheduled_start','scheduled_end','primary_assets','affected_assets','id','app_url'],
  maintenance_started: ['title','actual_start','scheduled_end','primary_assets','affected_assets','id','app_url'],
  maintenance_completed: ['title','actual_end','notes','primary_assets','affected_assets','id','app_url'],
  maintenance_reopened: ['title','impact_level','reopened_at','reopen_reason','primary_assets','affected_assets','id','app_url'],
  maintenance_cancelled: ['title','reason','primary_assets','affected_assets','id','app_url'],
  maintenance_rejected: ['title','reason','primary_assets','affected_assets','id','app_url'],
  maintenance_owner_approval_requested: ['title','owner_source_type','owner_source_name','scheduled_start','scheduled_end','created_by_name','approval_url','app_url'],
  maintenance_owner_reschedule_proposed: ['title','owner_name','proposed_start','proposed_end','response_note','app_url','id'],
  maintenance_owner_reschedule_countered: ['title','creator_proposed_start','creator_proposed_end','creator_response_note','approval_url','app_url'],
  incident_created: ['title','severity','status','description','started_at','primary_assets','affected_assets','id','app_url'],
  incident_resolved: ['title','resolved_at','primary_assets','affected_assets','id','app_url'],
  blackout_scheduled: ['name','start_date','end_date','description','primary_assets','affected_assets','id','app_url'],
}

function renderNotifyPreview(html, vars) {
  if (!html) return ''
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`)
}

export default function Templates() {
  const [activeTab, setActiveTab] = useState('checklist')

  const [templates, setTemplates] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState({ name: '', type: 'planned', impact_level: 'medium', duration_minutes: 60, description: '' })

  const [emailTemplates, setEmailTemplates] = useState([])
  const [editingTpl, setEditingTpl] = useState(null)
  const [expandedTplGroups, setExpandedTplGroups] = useState({ maintenance: true })

  const load = () => templatesApi.list().then(r => setTemplates(r.data))
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (activeTab === 'email') {
      notificationsApi.templates().then(r => setEmailTemplates(r.data)).catch(() => {})
    }
  }, [activeTab])

  const handleCreate = async (e) => {
    e.preventDefault()
    try { await templatesApi.create(form); toast.success('Template creato'); setShowCreate(false); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const handleDelete = async () => {
    try { await templatesApi.delete(deleteTarget.id); toast.success('Eliminato'); setDeleteTarget(null); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Errore') }
  }

  const notifyTemplates = emailTemplates.filter(t => {
    const evt = String(t.event_type || '')
    return evt.startsWith('maintenance_') || evt.startsWith('blackout_')
  })

  const groupedNotifyTemplates = notifyTemplates.reduce((acc, tpl) => {
    const prefix = String(tpl.event_type || '').split('_')[0]
    const group = NOTIFY_GROUP_ORDER.includes(prefix) ? prefix : 'maintenance'
    if (!acc[group]) acc[group] = []
    acc[group].push(tpl)
    return acc
  }, {})

  const orderedNotifyGroups = NOTIFY_GROUP_ORDER
    .map(group => ({ group, templates: groupedNotifyTemplates[group] || [] }))
    .filter(g => g.templates.length > 0)

  const saveEditingTpl = async () => {
    try {
      await notificationsApi.updateTemplate(editingTpl.id, {
        subject_template: editingTpl.subject_template,
        body_html_template: editingTpl.body_html_template,
        is_active: editingTpl.is_active,
      })
      toast.success('Template saved')
      setEditingTpl(null)
      notificationsApi.templates().then(r => setEmailTemplates(r.data))
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  return (
    <Layout title="Templates">
      <div className="space-y-4">
        <div className="py-2 -mx-4 sm:mx-0 px-4 sm:px-0 border-b border-gray-200 dark:border-gray-700">
          <nav className="flex flex-wrap gap-1.5">
            {[['checklist', 'Maintenance Checklists'], ['email', 'Email Notifications']].map(([k, l]) => (
              <button
                key={k}
                onClick={() => setActiveTab(k)}
                className={`px-3.5 py-1.5 text-sm font-medium rounded-full transition-colors ${
                  activeTab === k ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                {l}
              </button>
            ))}
          </nav>
        </div>

        {activeTab === 'checklist' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />Nuovo Template</button>
            </div>

            <div className="space-y-3">
              {templates.map(t => (
                <div key={t.id} className="card p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-xs text-gray-500">{t.type} · {t.impact_level} · {t.duration_minutes} min</p>
                    {t.description && <p className="text-xs text-gray-400 mt-1">{t.description}</p>}
                  </div>
                  <button className="p-1 text-red-500 hover:bg-red-50 rounded" onClick={() => setDeleteTarget(t)}><Trash2 size={14} /></button>
                </div>
              ))}
              {templates.length === 0 && <p className="text-center text-gray-500 py-8">Nessun template</p>}
            </div>
          </div>
        )}

        {activeTab === 'email' && (
          <div className="card p-5 sm:p-6">
            <p className="text-sm text-gray-500 mb-4">
              Customize the email content sent to affected users, owners and approvers for maintenance and blackout events.
              Use <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded text-xs">{'{{variable}}'}</code> placeholders — preview uses sample data.
            </p>
            <div className="space-y-4">
              {orderedNotifyGroups.map(({ group, templates: groupTemplates }) => (
                <div key={group} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-gray-700/50 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    onClick={() => setExpandedTplGroups(prev => ({ ...prev, [group]: !prev[group] }))}
                  >
                    <div className="flex items-center gap-2">
                      {expandedTplGroups[group] ? <ChevronDown size={15} className="text-gray-500" /> : <ChevronRight size={15} className="text-gray-500" />}
                      <h3 className="font-semibold text-sm">{NOTIFY_GROUP_LABELS[group] || group}</h3>
                    </div>
                    <span className="text-xs text-gray-500">{groupTemplates.length} template{groupTemplates.length > 1 ? 's' : ''}</span>
                  </button>
                  {expandedTplGroups[group] && (
                    <div className="p-3 space-y-3">
                      {groupTemplates.map(tpl => (
                        <div key={tpl.id} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/50">
                            <div className="flex items-center gap-3">
                              <span className="font-medium text-sm capitalize">{tpl.event_type?.replace(/_/g, ' ')}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tpl.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {tpl.is_active ? 'Active' : 'Disabled'}
                              </span>
                            </div>
                            <button
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors"
                              onClick={() => setEditingTpl(editingTpl?.id === tpl.id ? null : { ...tpl, _tab: 'edit' })}>
                              <Pencil size={13} />{editingTpl?.id === tpl.id ? 'Close' : 'Edit'}
                            </button>
                          </div>

                          {editingTpl?.id !== tpl.id && (
                            <div className="px-4 py-2">
                              <p className="text-xs text-gray-500 font-mono truncate">{tpl.subject_template || <span className="italic text-gray-300">No subject</span>}</p>
                            </div>
                          )}

                          {editingTpl?.id === tpl.id && (
                            <div className="p-4 space-y-4">
                              <div className="flex items-center gap-3">
                                <label className="text-sm font-medium w-16">Active</label>
                                <button type="button"
                                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${editingTpl.is_active ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                                  onClick={() => setEditingTpl(t => ({ ...t, is_active: !t.is_active }))}>
                                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${editingTpl.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                </button>
                              </div>

                              <div>
                                <label className="block text-sm font-medium mb-1">Subject</label>
                                <input className="input font-mono text-sm" value={editingTpl.subject_template || ''}
                                  onChange={e => setEditingTpl(t => ({ ...t, subject_template: e.target.value }))} />
                                {editingTpl.subject_template && (
                                  <p className="text-xs text-gray-400 mt-1 font-mono truncate">Preview: {renderNotifyPreview(editingTpl.subject_template, NOTIFY_SAMPLE_VARS)}</p>
                                )}
                              </div>

                              <div>
                                <div className="flex gap-2 mb-1">
                                  <button className={`text-xs px-2.5 py-1 rounded font-medium border transition-colors ${(editingTpl._tab ?? 'edit') === 'edit' ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}
                                    onClick={() => setEditingTpl(t => ({ ...t, _tab: 'edit' }))}>HTML Source</button>
                                  <button className={`text-xs px-2.5 py-1 rounded font-medium border transition-colors ${editingTpl._tab === 'preview' ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}
                                    onClick={() => setEditingTpl(t => ({ ...t, _tab: 'preview' }))}><Eye size={12} className="inline mr-1" />Preview</button>
                                  <button className={`text-xs px-2.5 py-1 rounded font-medium border transition-colors ${editingTpl._tab === 'vars' ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}
                                    onClick={() => setEditingTpl(t => ({ ...t, _tab: 'vars' }))}>Placeholders</button>
                                </div>

                                {(editingTpl._tab ?? 'edit') === 'edit' && (
                                  <textarea className="input font-mono text-xs w-full" rows={10} value={editingTpl.body_html_template || ''}
                                    onChange={e => setEditingTpl(t => ({ ...t, body_html_template: e.target.value }))} />
                                )}

                                {editingTpl._tab === 'preview' && (
                                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white" style={{ height: 380 }}>
                                    <iframe
                                      key={editingTpl.body_html_template}
                                      srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;font-size:14px;padding:16px;margin:0;color:#111;background:#fff}</style></head><body>${renderNotifyPreview(editingTpl.body_html_template || '', NOTIFY_SAMPLE_VARS)}</body></html>`}
                                      sandbox="allow-same-origin"
                                      className="w-full h-full border-0"
                                      title="Email preview"
                                    />
                                  </div>
                                )}

                                {editingTpl._tab === 'vars' && (
                                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                    <table className="w-full text-xs">
                                      <thead className="bg-gray-50 dark:bg-gray-700/50">
                                        <tr>
                                          <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300 w-44">Placeholder</th>
                                          <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300">Sample value</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                                        {(NOTIFY_TPL_VARS[editingTpl.event_type] || []).map(key => (
                                          <tr key={key}>
                                            <td className="px-3 py-2">
                                              <button
                                                className="font-mono bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded hover:bg-indigo-100 transition-colors"
                                                title="Click to copy"
                                                onClick={() => navigator.clipboard?.writeText(`{{${key}}}`)}>
                                                {`{{${key}}}`}
                                              </button>
                                            </td>
                                            <td className="px-3 py-2 text-gray-400 font-mono">{NOTIFY_SAMPLE_VARS[key] ?? '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>

                              <div className="flex justify-end gap-2">
                                <button className="btn-secondary text-sm" onClick={() => setEditingTpl(null)}>Cancel</button>
                                <button className="btn-primary text-sm" onClick={saveEditingTpl}><Save size={14} />Save</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {notifyTemplates.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No email templates found</p>}
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <Modal title="Nuovo Template" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Nome *</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium mb-1">Tipo</label>
                <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select></div>
              <div><label className="block text-sm font-medium mb-1">Impatto</label>
                <select className="input" value={form.impact_level} onChange={e => setForm(f => ({ ...f, impact_level: e.target.value }))}>
                  {IMPACTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select></div>
            </div>
            <div><label className="block text-sm font-medium mb-1">Durata (min)</label><input className="input" type="number" min="1" value={form.duration_minutes} onChange={e => setForm(f => ({ ...f, duration_minutes: parseInt(e.target.value) }))} /></div>
            <div><label className="block text-sm font-medium mb-1">Descrizione</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Annulla</button>
              <button type="submit" className="btn-primary">Crea</button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && <ConfirmDialog title="Elimina Template" message={`Eliminare "${deleteTarget.name}"?`} danger confirmLabel="Elimina" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />}
    </Layout>
  )
}
