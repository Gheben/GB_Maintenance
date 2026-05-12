import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { Modal } from '../components/Modal'
import { ItemPicker } from '../components/ItemPicker'
import { toast } from '../components/Toast'
import { maintenanceApi, templatesApi, assetsApi, servicesApi } from '../api'
import { useNavigate } from 'react-router-dom'
import { StatusBadge } from '../components/StatusBadge'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, isSameDay, addMonths, subMonths } from 'date-fns'

const TYPES = ['planned','emergency','upgrade','security_patch','infrastructure','other']
const IMPACTS = ['critical','high','medium','low']

const STATUS_COLORS = {
  draft: 'bg-gray-200 text-gray-700',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-orange-100 text-orange-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-500',
}

export default function Calendar() {
  const [current, setCurrent] = useState(new Date())
  const [events, setEvents] = useState([])
  const navigate = useNavigate()

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [templates, setTemplates] = useState([])
  const [allAssets, setAllAssets] = useState([])
  const [allServices, setAllServices] = useState([])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    title: '', type: 'planned', impact_level: 'medium', description: '',
    scheduled_start: '', scheduled_end: '', template_id: '',
    asset_ids: [], service_ids: []
  })

  const loadEvents = () => {
    const from = format(startOfMonth(current), 'yyyy-MM-dd')
    const to = format(endOfMonth(current), 'yyyy-MM-dd')
    maintenanceApi.calendar({ from, to }).then(r => setEvents(r.data))
  }

  useEffect(() => { loadEvents() }, [current])
  useEffect(() => { templatesApi.list().then(r => setTemplates(r.data)) }, [])
  useEffect(() => {
    if (showCreate) {
      assetsApi.list({ limit: 500 }).then(r => setAllAssets(Array.isArray(r.data) ? r.data : (r.data.data || [])))
      servicesApi.list({ limit: 500 }).then(r => setAllServices(Array.isArray(r.data) ? r.data : (r.data.data || [])))
    }
  }, [showCreate])

  const openCreate = (day) => {
    const dateStr = format(day, 'yyyy-MM-dd')
    setForm({
      title: '', type: 'planned', impact_level: 'medium', description: '',
      scheduled_start: `${dateStr}T09:00`,
      scheduled_end: `${dateStr}T18:00`,
      template_id: '', asset_ids: [], service_ids: []
    })
    setShowCreate(true)
  }

  const toggleAsset = (id) => setForm(f => ({
    ...f, asset_ids: f.asset_ids.includes(id) ? f.asset_ids.filter(x => x !== id) : [...f.asset_ids, id]
  }))
  const toggleService = (id) => setForm(f => ({
    ...f, service_ids: f.service_ids.includes(id) ? f.service_ids.filter(x => x !== id) : [...f.service_ids, id]
  }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { toast.error('Title is required'); return }
    if (!form.scheduled_start || !form.scheduled_end) { toast.error('Dates are required'); return }
    setCreating(true)
    try {
      const res = await maintenanceApi.create(form)
      toast.success('Maintenance created')
      setShowCreate(false)
      loadEvents()
      navigate(`/maintenance/${res.data.id}`)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Creation error')
    } finally {
      setCreating(false)
    }
  }

  const days = eachDayOfInterval({ start: startOfMonth(current), end: endOfMonth(current) })

  // Pad to start on Monday
  const firstDow = (startOfMonth(current).getDay() + 6) % 7 // 0=Mon
  const padBefore = Array(firstDow).fill(null)

  const eventsForDay = (day) => events.filter(e => {
    const start = new Date(e.scheduled_start)
    const end = new Date(e.scheduled_end)
    return day >= new Date(format(start, 'yyyy-MM-dd')) && day <= new Date(format(end, 'yyyy-MM-dd'))
  })

  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <Layout title="Maintenance Calendar">
      <div className="max-w-5xl space-y-4">
        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setCurrent(subMonths(current, 1))}><ChevronLeft size={20} /></button>
          <h2 className="text-lg font-bold capitalize">{format(current, 'MMMM yyyy')}</h2>
          <button className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setCurrent(addMonths(current, 1))}><ChevronRight size={20} /></button>
        </div>

        {/* Grid */}
        <div className="card overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b divide-x divide-gray-100 dark:divide-gray-700 border-gray-100 dark:border-gray-700">
            {DOW.map(d => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-gray-500">{d}</div>
            ))}
          </div>

          {/* Days */}
          <div className="grid grid-cols-7 divide-x divide-y divide-gray-100 dark:divide-gray-700">
            {padBefore.map((_, i) => <div key={`p${i}`} className="min-h-[100px] bg-gray-50 dark:bg-gray-800/50" />)}
            {days.map(day => {
              const dayEvents = eventsForDay(day)
              return (
                <div
                  key={day.toISOString()}
                  className={`min-h-[100px] p-1.5 cursor-pointer group relative ${!isSameMonth(day, current) ? 'bg-gray-50 dark:bg-gray-800/50' : ''} ${isToday(day) ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/20'}`}
                  onClick={() => openCreate(day)}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`inline-block w-6 h-6 text-center text-sm leading-6 rounded-full ${isToday(day) ? 'bg-brand-600 text-white font-bold' : 'text-gray-700 dark:text-gray-300'}`}>
                      {format(day, 'd')}
                    </span>
                    <Plus size={12} className="text-gray-300 group-hover:text-brand-400 transition-colors" />
                  </div>
                  <div className="space-y-0.5" onClick={e => e.stopPropagation()}>
                    {dayEvents.slice(0, 3).map(e => (
                      <button key={e.id} onClick={() => navigate(`/maintenance/${e.id}`)}
                        className={`w-full text-left text-xs px-1.5 py-0.5 rounded truncate ${STATUS_COLORS[e.status] || 'bg-gray-100'}`}>
                        {e.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 && <p className="text-xs text-gray-400 pl-1">+{dayEvents.length - 3} more</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-xs">
          {Object.entries(STATUS_COLORS).map(([s, cls]) => (
            <span key={s} className={`px-2 py-0.5 rounded ${cls}`}>{s.replace('_', ' ')}</span>
          ))}
        </div>
      </div>

      {/* Create modal */}
      {showCreate && (
        <Modal title="New Maintenance" onClose={() => setShowCreate(false)} size="lg">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title *</label>
              <input className="input" value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} autoFocus />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select className="input" value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
                  {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Impact</label>
                <select className="input" value={form.impact_level} onChange={e => setForm(f => ({...f, impact_level: e.target.value}))}>
                  {IMPACTS.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Start *</label>
                <input type="datetime-local" className="input" value={form.scheduled_start} onChange={e => setForm(f => ({...f, scheduled_start: e.target.value}))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">End *</label>
                <input type="datetime-local" className="input" value={form.scheduled_end} onChange={e => setForm(f => ({...f, scheduled_end: e.target.value}))} />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} />
            </div>

            {templates.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1">Notification template</label>
                <select className="input" value={form.template_id} onChange={e => setForm(f => ({...f, template_id: e.target.value}))}>
                  <option value="">None</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}

            <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 space-y-4">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Assets and Services</h4>
              <ItemPicker
                label={`Assets (${form.asset_ids.length} selected)`}
                allItems={allAssets}
                selectedIds={form.asset_ids}
                onToggle={toggleAsset}
                badgeKey="criticality"
              />
              <ItemPicker
                label={`Services (${form.service_ids.length} selected)`}
                allItems={allServices}
                selectedIds={form.service_ids}
                onToggle={toggleService}
                badgeKey="criticality"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={creating}>{creating ? 'Creating...' : 'Create Maintenance'}</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
