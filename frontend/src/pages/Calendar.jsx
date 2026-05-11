import { useState, useEffect } from 'react'
import { Layout } from '../components/Layout'
import { maintenanceApi } from '../api'
import { useNavigate } from 'react-router-dom'
import { StatusBadge } from '../components/StatusBadge'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday, isSameDay, addMonths, subMonths } from 'date-fns'
import { it } from 'date-fns/locale'

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

  useEffect(() => {
    const from = format(startOfMonth(current), 'yyyy-MM-dd')
    const to = format(endOfMonth(current), 'yyyy-MM-dd')
    maintenanceApi.calendar({ from, to }).then(r => setEvents(r.data))
  }, [current])

  const days = eachDayOfInterval({ start: startOfMonth(current), end: endOfMonth(current) })

  // Pad to start on Monday
  const firstDow = (startOfMonth(current).getDay() + 6) % 7 // 0=Mon
  const padBefore = Array(firstDow).fill(null)

  const eventsForDay = (day) => events.filter(e => {
    const start = new Date(e.scheduled_start)
    const end = new Date(e.scheduled_end)
    return day >= new Date(format(start, 'yyyy-MM-dd')) && day <= new Date(format(end, 'yyyy-MM-dd'))
  })

  const DOW = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

  return (
    <Layout title="Calendario Manutenzioni">
      <div className="max-w-5xl space-y-4">
        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setCurrent(subMonths(current, 1))}><ChevronLeft size={20} /></button>
          <h2 className="text-lg font-bold capitalize">{format(current, 'MMMM yyyy', { locale: it })}</h2>
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
                <div key={day.toISOString()} className={`min-h-[100px] p-1.5 ${!isSameMonth(day, current) ? 'bg-gray-50' : ''} ${isToday(day) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                  <span className={`inline-block w-6 h-6 text-center text-sm leading-6 rounded-full mb-1 ${isToday(day) ? 'bg-brand-600 text-white font-bold' : 'text-gray-700 dark:text-gray-300'}`}>
                    {format(day, 'd')}
                  </span>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map(e => (
                      <button key={e.id} onClick={() => navigate(`/maintenance/${e.id}`)}
                        className={`w-full text-left text-xs px-1.5 py-0.5 rounded truncate ${STATUS_COLORS[e.status] || 'bg-gray-100'}`}>
                        {e.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 && <p className="text-xs text-gray-400 pl-1">+{dayEvents.length - 3} altri</p>}
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
    </Layout>
  )
}
