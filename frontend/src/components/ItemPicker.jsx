import { useState } from 'react'
import { Search, X, ChevronDown, ChevronUp } from 'lucide-react'

export function ItemPicker({ label, allItems, selectedIds, onToggle, nameKey = 'name', badgeKey }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = allItems.filter(item =>
    item[nameKey].toLowerCase().includes(search.toLowerCase())
  )
  const selected = allItems.filter(i => selectedIds.includes(i.id))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium">{label}</label>
        <button type="button" onClick={() => setOpen(o => !o)} className="text-xs text-brand-600 hover:underline flex items-center gap-1">
          {open ? <><ChevronUp size={13}/> Chiudi</> : <><ChevronDown size={13}/> Seleziona</>}
        </button>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map(item => (
            <span key={item.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
              {item[nameKey]}
              {badgeKey && item[badgeKey] && <span className="opacity-60">({item[badgeKey]})</span>}
              <button type="button" onClick={() => onToggle(item.id)} className="hover:text-red-500"><X size={11}/></button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
          <div className="p-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600">
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-7 py-1 text-sm"
                placeholder="Cerca..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.length === 0 ? (
              <div className="text-center py-4 text-sm text-gray-500">Nessun risultato</div>
            ) : filtered.map(item => (
              <label key={item.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.id)}
                  onChange={() => onToggle(item.id)}
                  className="rounded"
                />
                <span className="flex-1">{item[nameKey]}</span>
                {badgeKey && item[badgeKey] && (
                  <span className="text-xs text-gray-400">{item[badgeKey]}</span>
                )}
                {item.status && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    item.status === 'operational' ? 'bg-green-100 text-green-700' :
                    item.status === 'degraded' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>{item.status}</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
