import { ShieldCheck } from 'lucide-react'

export function PartIsServiceNotice({ services = [], selectedIds = [] }) {
  const selectedIdSet = new Set(selectedIds.map(id => String(id)))
  const selectedServices = services.filter(service => (
    selectedIdSet.has(String(service.id))
    && (service.part_is_relevant === true || String(service.part_is_relevant).toLowerCase() === 'true')
  ))

  if (selectedServices.length === 0) return null

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
      <ShieldCheck size={20} className="mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-semibold">Part-IS services selected</p>
        <p className="mt-0.5 text-xs">{selectedServices.map(service => service.name).join(', ')}</p>
      </div>
    </div>
  )
}
