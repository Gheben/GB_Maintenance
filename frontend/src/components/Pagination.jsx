import { ChevronLeft, ChevronRight } from 'lucide-react'

const PAGE_SIZES = [10, 25, 50, 100]

export function Pagination({ page, limit, total, onChange, onLimitChange }) {
  const totalPages = Math.ceil(total / limit)
  if (total === 0) return null
  const from = (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  return (
    <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 flex-wrap gap-2">
      <div className="flex items-center gap-3">
        <span>{from}–{to} of {total}</span>
        {onLimitChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">per page:</span>
            <select
              className="text-xs border border-gray-200 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
              value={limit}
              onChange={e => { onLimitChange(parseInt(e.target.value)); onChange(1) }}
            >
              {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
            disabled={page <= 1} onClick={() => onChange(page - 1)}>
            <ChevronLeft size={16} />
          </button>
          <span className="px-3">{page} / {totalPages}</span>
          <button className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
            disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
