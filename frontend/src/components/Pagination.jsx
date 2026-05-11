import { ChevronLeft, ChevronRight } from 'lucide-react'

export function Pagination({ page, limit, total, onChange }) {
  const totalPages = Math.ceil(total / limit)
  if (totalPages <= 1) return null
  const from = (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  return (
    <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
      <span>{from}–{to} di {total}</span>
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
    </div>
  )
}
