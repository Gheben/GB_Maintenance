import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { Search, User, Users, X } from 'lucide-react'
import { settingsApi } from '../api'

const MAX_VISIBLE = 120

function sourceLabel(owner) {
  if (String(owner?.source || '').toLowerCase() === 'ldap') return 'LDAP'
  if (owner?.type === 'ldap_user' || owner?.type === 'ldap_group') return 'LDAP'
  return 'Local'
}

function typeLabel(type) {
  if (type === 'user') return 'User'
  if (type === 'local_group') return 'Group'
  if (type === 'ldap_user') return 'LDAP user'
  if (type === 'ldap_group') return 'LDAP group'
  return String(type || 'owner')
}

function ownerKey(owner) {
  return `${owner.type}:${owner.id || owner.dn || ''}`
}

function normalizeOwner(owner) {
  if (!owner || typeof owner !== 'object') return null
  const type = String(owner.type || '').trim()
  if (!['user', 'local_group', 'ldap_user', 'ldap_group'].includes(type)) return null
  const id = owner.id ? String(owner.id).trim() : ''
  const dn = owner.dn ? String(owner.dn).trim() : ''
  if (!id && !dn) return null
  return {
    type,
    id: id || undefined,
    dn: dn || undefined,
    name: owner.name ? String(owner.name).trim() : '',
    email: owner.email ? String(owner.email).trim() : '',
    source: owner.source ? String(owner.source).trim().toLowerCase() : undefined,
  }
}

export function OwnerPickerModal({
  open,
  onClose,
  value,
  onChange,
  users,
  localGroups,
  ldapEnabled,
}) {
  const [tab, setTab] = useState('users')
  const [search, setSearch] = useState('')
  const [ldapResults, setLdapResults] = useState([])
  const [loading, setLoading] = useState(false)

  const selected = useMemo(() => {
    const list = Array.isArray(value) ? value.map(normalizeOwner).filter(Boolean) : []
    const seen = new Set()
    const out = []
    for (const owner of list) {
      const key = ownerKey(owner)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(owner)
    }
    return out
  }, [value])

  useEffect(() => {
    if (!open) return
    setSearch('')
    setLdapResults([])
    setLoading(false)
  }, [open])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!ldapEnabled) return
      const q = String(search || '').trim()
      if (q.length < 2) {
        setLdapResults([])
        return
      }

      setLoading(true)
      try {
        if (tab === 'users') {
          const r = await settingsApi.searchLdapUsers(q)
          if (cancelled) return
          const rows = Array.isArray(r.data) ? r.data : []
          setLdapResults(rows.map(u => ({
            type: 'ldap_user',
            dn: u.dn,
            name: u.name || u.username || u.email || u.dn,
            email: u.email || '',
            source: 'ldap',
          })))
        } else {
          const r = await settingsApi.searchLdapGroups(q)
          if (cancelled) return
          const rows = Array.isArray(r.data) ? r.data : []
          setLdapResults(rows.map(g => ({
            type: 'ldap_group',
            dn: g.dn,
            name: g.name || g.dn,
            email: '',
            source: 'ldap',
          })))
        }
      } catch {
        if (!cancelled) setLdapResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [tab, search, ldapEnabled])

  const selectedKeys = new Set(selected.map(ownerKey))

  const localCandidates = useMemo(() => {
    const q = String(search || '').trim().toLowerCase()
    if (tab === 'users') {
      return (users || [])
        .filter(u => {
          if (!q) return true
          return String(u.display_name || u.username || '').toLowerCase().includes(q)
            || String(u.username || '').toLowerCase().includes(q)
            || String(u.email || '').toLowerCase().includes(q)
        })
        .map(u => ({
          type: 'user',
          id: u.id,
          name: u.display_name || u.username || 'User',
          email: u.email || '',
          source: String(u.auth_type || '').toLowerCase() === 'ldap' ? 'ldap' : 'local',
        }))
    }

    return (localGroups || [])
      .filter(g => {
        if (!q) return true
        return String(g.name || '').toLowerCase().includes(q)
      })
      .map(g => {
        const isLdapGroup = String(g.type || '').toLowerCase() === 'ldap_group' || Number(g.ldap_mapping_count || 0) > 0
        return {
          type: isLdapGroup ? 'ldap_group' : 'local_group',
          id: g.id,
          dn: g.ldap_group_dn || undefined,
          name: g.name || 'Group',
          email: '',
          source: isLdapGroup ? 'ldap' : 'local',
        }
      })
  }, [tab, search, users, localGroups])

  const mergedCandidates = useMemo(() => {
    const map = new Map()
    for (const c of [...localCandidates, ...ldapResults]) {
      const normalized = normalizeOwner(c)
      if (!normalized) continue
      map.set(ownerKey(normalized), normalized)
    }
    return [...map.values()]
  }, [localCandidates, ldapResults])

  const visible = mergedCandidates.slice(0, MAX_VISIBLE)

  const updateSelection = (owner) => {
    const normalized = normalizeOwner(owner)
    if (!normalized) return
    const key = ownerKey(normalized)
    const exists = selectedKeys.has(key)
    let next = []
    if (exists) next = selected.filter(o => ownerKey(o) !== key)
    else next = [...selected, normalized]
    onChange(next)
  }

  return open ? (
    <Modal title="Select Owners" onClose={onClose} size="xl">
      <div className="space-y-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('users')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border ${tab === 'users' ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            <User size={14} /> Users
          </button>
          <button
            type="button"
            onClick={() => setTab('groups')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border ${tab === 'groups' ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            <Users size={14} /> Groups
          </button>
        </div>

        <div className="relative">
          <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
          <input
            className="input pl-9"
            placeholder={ldapEnabled ? 'Search local + LDAP (min 2 chars for LDAP)...' : 'Search local owners...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map(owner => (
              <span key={ownerKey(owner)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-brand-100 text-brand-700">
                {owner.name || owner.id || owner.dn}
                <span className="opacity-70">{typeLabel(owner.type)}</span>
                <button type="button" onClick={() => updateSelection(owner)} className="hover:text-red-600"><X size={11} /></button>
              </span>
            ))}
          </div>
        )}

        <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
          <div className="max-h-[55vh] overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
            {loading && <div className="px-3 py-2 text-xs text-gray-500">Searching LDAP...</div>}
            {visible.length === 0 ? (
              <div className="text-center py-6 text-sm text-gray-500">No owners found</div>
            ) : visible.map(owner => {
              const key = ownerKey(owner)
              return (
                <label key={key} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer text-sm">
                  <input type="checkbox" checked={selectedKeys.has(key)} onChange={() => updateSelection(owner)} className="rounded" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{owner.name || owner.id || owner.dn}</span>
                    {owner.email && <span className="block truncate text-xs text-gray-400">{owner.email}</span>}
                  </span>
                  <span className="text-xs text-gray-500 hidden sm:inline">{typeLabel(owner.type)}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${sourceLabel(owner) === 'LDAP' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                    {sourceLabel(owner)}
                  </span>
                </label>
              )
            })}
          </div>
          {mergedCandidates.length > visible.length && (
            <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-200 dark:border-gray-600">
              Showing first {visible.length} results of {mergedCandidates.length}. Refine search.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  ) : null
}
