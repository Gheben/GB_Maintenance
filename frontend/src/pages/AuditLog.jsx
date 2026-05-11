import { useState, useEffect, useCallback } from 'react'
import { Layout } from '../components/Layout'
import { auditApi } from '../api'
import { Pagination } from '../components/Pagination'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { Search } from 'lucide-react'

export default function AuditLog() {
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filters, setFilters] = useState({ username: '', action: '', entity_type: '' })

  const load = useCallback(() => {
    auditApi.list({ ...filters, page, limit: 50 })
      .then(r => { setEntries(r.data.data); setTotal(r.data.total) })
  }, [filters, page])

  useEffect(() => { load() }, [load])

  return (
    <Layout title="Audit Log">
      <div className="max-w-6xl space-y-4">
        <div className="flex flex-wrap gap-3">
          {[['username','Username'],['action','Azione'],['entity_type','Tipo entità']].map(([k,l]) => (
            <div key={k} className="relative">
              <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
              <input className="input pl-8 w-40" placeholder={l}
                value={filters[k]} onChange={e => { setFilters(f => ({ ...f, [k]: e.target.value })); setPage(1) }} />
            </div>
          ))}
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>{['Data','Utente','Azione','Tipo','ID','IP'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {entries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{format(new Date(e.created_at), 'dd/MM HH:mm:ss', { locale: it })}</td>
                    <td className="px-4 py-2 text-xs">{e.username}</td>
                    <td className="px-4 py-2 text-xs font-mono">{e.action}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{e.entity_type}</td>
                    <td className="px-4 py-2 text-xs font-mono text-gray-400 truncate max-w-[120px]">{e.entity_id}</td>
                    <td className="px-4 py-2 text-xs text-gray-400">{e.ip_address}</td>
                  </tr>
                ))}
                {entries.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-500">Nessun evento</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="p-4"><Pagination page={page} limit={50} total={total} onChange={setPage} /></div>
        </div>
      </div>
    </Layout>
  )
}
