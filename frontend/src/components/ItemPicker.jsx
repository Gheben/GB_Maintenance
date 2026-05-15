import { useState } from 'react'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import { Modal } from './Modal'

export function ItemPicker({ label, allItems, selectedIds, onToggle, nameKey = 'name', badgeKey, useModal = false, filterKey, maxResults }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [filter, setFilter] = useState('all')

  const activeFilterKey = filterKey || badgeKey || null
  const filterOptions = activeFilterKey
    ? [...new Set(allItems.map(item => String(item?.[activeFilterKey] || '').trim()).filter(Boolean))]
    : []

  const filtered = allItems.filter(item => {
    const byText = String(item?.[nameKey] || '').toLowerCase().includes(search.toLowerCase())
    const byFilter = filter === 'all' || !activeFilterKey || String(item?.[activeFilterKey] || '') === filter
    return byText && byFilter
  })
  const visibleLimit = Number.isFinite(Number(maxResults)) && Number(maxResults) > 0
    ? Number(maxResults)
    : (useModal ? 120 : 50)
  const visible = filtered.slice(0, visibleLimit)
  const selected = allItems.filter(i => selectedIds.includes(i.id))

  const renderList = () => (
    <>
      <div className="p-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600 space-y-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-7 py-1 text-sm"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {filterOptions.length > 0 && (
          <select className="input py-1 text-sm" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All</option>
            {filterOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
      </div>
      <div className={`${useModal ? 'max-h-[55vh]' : 'max-h-48'} overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700`}>
        {filtered.length === 0 ? (
          <div className="text-center py-4 text-sm text-gray-500">No results</div>
        ) : visible.map(item => (
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
      {filtered.length > visible.length && (
        <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-200 dark:border-gray-600">
          Showing first {visible.length} results of {filtered.length}. Refine search/filter.
        </div>
      )}
    </>
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium">{label}</label>
        {useModal ? (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            Select
          </button>
        ) : (
          <button type="button" onClick={() => setOpen(o => !o)} className="action-text-btn">
            {open ? <><ChevronUp size={13}/> Close</> : <><ChevronDown size={13}/> Select</>}
          </button>
        )}
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
          {renderList()}
        </div>
      )}

      {useModal && modalOpen && (
        <Modal title={label} onClose={() => setModalOpen(false)} size="lg">
          <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
            {renderList()}
          </div>
          <div className="flex justify-end mt-3">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
