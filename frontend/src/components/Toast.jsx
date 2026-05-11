import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react'

let _addToast = null
export const toast = {
  success: (msg) => _addToast?.({ type: 'success', msg }),
  error:   (msg) => _addToast?.({ type: 'error', msg }),
  info:    (msg) => _addToast?.({ type: 'info', msg }),
  warn:    (msg) => _addToast?.({ type: 'warn', msg }),
}

const ICONS = { success: CheckCircle, error: XCircle, info: Info, warn: AlertTriangle }
const COLORS = {
  success: 'bg-green-50 border-green-200 text-green-800',
  error:   'bg-red-50 border-red-200 text-red-800',
  info:    'bg-blue-50 border-blue-200 text-blue-800',
  warn:    'bg-yellow-50 border-yellow-200 text-yellow-800',
}

export function ToastContainer() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    _addToast = ({ type, msg }) => {
      const id = Date.now()
      setToasts(prev => [...prev, { id, type, msg }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
    }
    return () => { _addToast = null }
  }, [])

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map(t => {
        const Icon = ICONS[t.type]
        return (
          <div key={t.id} className={`flex items-start gap-2 rounded-lg border px-4 py-3 shadow-lg ${COLORS[t.type]}`}>
            <Icon size={18} className="mt-0.5 shrink-0" />
            <p className="flex-1 text-sm">{t.msg}</p>
            <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}><X size={14} /></button>
          </div>
        )
      })}
    </div>
  )
}
