import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { usersApi, groupsApi, settingsApi } from '../api'
import { Pagination } from '../components/Pagination'
import { Modal, ConfirmDialog } from '../components/Modal'
import { toast } from '../components/Toast'
import { Plus, Trash2, Users as UsersIcon, X, User, Shield, CheckCircle, XCircle, Pencil, Save, ShieldCheck, Wand2, Eye, EyeOff } from 'lucide-react'
import { QuickCreateLocalGroupModal, QuickCreateUserModal } from '../components/QuickCreateModals'

const DEFAULT_ROLES = ['admin','change_manager','operator','viewer','subscriber']
const TABS = [
  { id: 'users',  label: 'Users',        icon: User },
  { id: 'groups', label: 'Groups',       icon: UsersIcon },
  { id: 'roles',  label: 'Roles',         icon: ShieldCheck },
]

const ALL_PERMS = [
  { key: 'dashboard',     label: 'Dashboard' },
  { key: 'assets',        label: 'Assets' },
  { key: 'services',      label: 'Services' },
  { key: 'maintenance',   label: 'Maintenance' },
  { key: 'incidents',     label: 'Incidents' },
  { key: 'calendar',      label: 'Calendar' },
  { key: 'status_page',   label: 'Status Page' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'reports',       label: 'Reports' },
  { key: 'users',         label: 'Users & Groups' },
  { key: 'settings',      label: 'Settings' },
  { key: 'apikeys',       label: 'API Keys' },
  { key: 'audit',         label: 'Audit Log' },
]

const PASSWORD_RULES = [
  { key: 'len', label: 'At least 8 characters', test: (v) => String(v || '').length >= 8 },
  { key: 'upper', label: 'At least 1 uppercase letter (A-Z)', test: (v) => /[A-Z]/.test(String(v || '')) },
  { key: 'num', label: 'At least 1 number (0-9)', test: (v) => /[0-9]/.test(String(v || '')) },
  { key: 'special', label: 'At least 1 special character', test: (v) => /[^A-Za-z0-9]/.test(String(v || '')) },
]

function passwordPolicyOk(password) {
  return PASSWORD_RULES.every((r) => r.test(password))
}

function getPasswordStrength(password) {
  const value = String(password || '')
  if (!value) return { score: 0, level: 'none', label: '' }

  const baseScore = PASSWORD_RULES.reduce((acc, r) => acc + (r.test(value) ? 1 : 0), 0)
  const lengthBonus = value.length >= 12 ? 1 : 0
  const score = baseScore + lengthBonus

  if (score <= 2) return { score, level: 'weak', label: 'Weak' }
  if (score <= 4) return { score, level: 'medium', label: 'Medium' }
  return { score, level: 'strong', label: 'Strong' }
}

function generateStrongPassword(length = 14) {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lower = 'abcdefghijklmnopqrstuvwxyz'
  const digits = '0123456789'
  const special = '!@#$%^&*()-_=+[]{};:,.?'
  const all = `${upper}${lower}${digits}${special}`

  const pick = (chars) => chars[Math.floor(Math.random() * chars.length)]
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)]

  for (let i = chars.length; i < Math.max(8, length); i += 1) {
    chars.push(pick(all))
  }

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = chars[i]
    chars[i] = chars[j]
    chars[j] = tmp
  }

  const password = chars.join('')
  return passwordPolicyOk(password) ? password : generateStrongPassword(length)
}

function PasswordRequirements({ password, optional = false }) {
  const value = String(password || '')
  if (!value.length) return null

  const checks = PASSWORD_RULES.map((r) => ({ ...r, ok: r.test(value) }))
  const strength = getPasswordStrength(value)
  const strengthWidth = `${Math.min(100, Math.max(10, (strength.score / 5) * 100))}%`
  const strengthBarClass = strength.level === 'strong'
    ? 'bg-green-500'
    : strength.level === 'medium'
      ? 'bg-amber-500'
      : 'bg-red-500'
  const strengthTextClass = strength.level === 'strong'
    ? 'text-green-600 dark:text-green-400'
    : strength.level === 'medium'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-red-600 dark:text-red-400'

  return (
    <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/60 px-3 py-2">
      <p className="text-xs font-medium text-gray-600 dark:text-gray-300">
        Password requirements {optional && <span className="font-normal text-gray-400">(applied only if you set a new password)</span>}
      </p>
      <div className="mt-2">
        <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div className={`h-full transition-all ${strengthBarClass}`} style={{ width: strengthWidth }} />
        </div>
        <p className={`mt-1 text-xs font-medium ${strengthTextClass}`}>Strength: {strength.label}</p>
      </div>
      <ul className="mt-2 space-y-1">
        {checks.map((r) => (
          <li key={r.key} className={`text-xs flex items-center gap-1.5 ${r.ok ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
            {r.ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
            <span>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AuthBadge({ authType }) {
  if (authType === 'ldap') return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">LDAP</span>
  return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Local</span>
}

function authAccentClass(authType) {
  return authType === 'ldap' ? 'bg-sky-500' : 'bg-emerald-500'
}

function RoleBadge({ role }) {
  const colors = {
    superadmin: 'bg-purple-100 text-purple-700',
    admin: 'bg-blue-100 text-blue-700',
    change_manager: 'bg-indigo-100 text-indigo-700',
    operator: 'bg-green-100 text-green-700',
    viewer: 'bg-gray-100 text-gray-600',
    subscriber: 'bg-yellow-100 text-yellow-700',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${colors[role] || 'bg-gray-100 text-gray-600'}`}>{role}</span>
}

function extractRoleOptions(presets) {
  const roles = Array.isArray(presets)
    ? presets
      .map(p => String(p?.name || p?.id || '').trim())
      .filter(Boolean)
    : []
  const merged = [...new Set([...DEFAULT_ROLES, ...roles])]
  return merged.length ? merged : DEFAULT_ROLES
}

function extractRoleProfiles(presets) {
  const map = {}
  if (Array.isArray(presets)) {
    for (const p of presets) {
      const key = String(p?.name || p?.id || '').trim()
      if (key) map[key] = p?.permissions && typeof p.permissions === 'object' ? p.permissions : {}
    }
  }
  return map
}

function mergeWithRoleBaseline(role, currentPermissions, roleProfiles) {
  const baseline = roleProfiles?.[role] || {}
  const current = currentPermissions || {}
  const merged = {}
  for (const k of Object.keys(baseline)) {
    if (baseline[k]) merged[k] = true
  }
  for (const k of Object.keys(current)) {
    if (current[k]) merged[k] = true
  }
  return merged
}

function rebaseRolePermissions(prevRole, nextRole, currentPermissions, roleProfiles) {
  const prevLocked = roleBaselineLockedKeys(prevRole, roleProfiles)
  const current = currentPermissions || {}
  const extras = {}
  for (const k of Object.keys(current)) {
    if (current[k] && !prevLocked.has(k)) extras[k] = true
  }
  return mergeWithRoleBaseline(nextRole, extras, roleProfiles)
}

function roleBaselineLockedKeys(role, roleProfiles) {
  const baseline = roleProfiles?.[role] || {}
  return new Set(Object.keys(baseline).filter(k => !!baseline[k]))
}

function PermissionsEditor({ value, onChange, disabled, lockedKeys = new Set() }) {
  return (
    <div className="grid grid-cols-2 gap-2 mt-2">
      {ALL_PERMS.map(p => (
        <label key={p.key} className={`flex items-center gap-2 text-sm cursor-pointer select-none ${(disabled || lockedKeys.has(p.key)) ? 'opacity-40 pointer-events-none' : ''}`}>
          <input
            type="checkbox"
            checked={!!value[p.key]}
            onChange={() => onChange({ ...value, [p.key]: !value[p.key] })}
            disabled={disabled || lockedKeys.has(p.key)}
            className="accent-blue-600"
          />
          {p.label}
        </label>
      ))}
    </div>
  )
}

function LocalGroupPicker({ groups, value, onChange, required }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pickerGroups, setPickerGroups] = useState(groups || [])
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const localGroups = pickerGroups.filter(g => !g.ldap_mapping_count || g.ldap_mapping_count === 0)
  const selected = localGroups.find(g => g.id === value)
  const filtered = q.trim()
    ? localGroups.filter(g => String(g.name || '').toLowerCase().includes(q.trim().toLowerCase()))
    : localGroups

  useEffect(() => {
    setPickerGroups(groups || [])
  }, [groups])

  return (
    <div>
      <label className="block text-sm font-medium mb-1">Local group {required ? '*' : ''}</label>
      <button type="button" className="input w-full text-left" onClick={() => setOpen(true)}>
        {selected?.name || 'Select group'}
      </button>
      {required && <input type="hidden" required value={value || ''} onChange={() => {}} />}

      {open && (
        <Modal title="Select Local Group" onClose={() => { setOpen(false); setQ('') }}>
          <div className="space-y-3">
            <div className="relative">
              <input className="input" placeholder="Search group..." value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <div className="flex justify-start">
              <button type="button" className="btn-secondary" onClick={() => setShowCreateGroup(true)}>New local group</button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(g => (
                <button
                  key={g.id}
                  type="button"
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 ${value === g.id ? 'bg-brand-50 text-brand-700' : ''}`}
                  onClick={() => {
                    onChange(g.id)
                    setOpen(false)
                    setQ('')
                  }}
                >
                  {g.name}
                </button>
              ))}
              {filtered.length === 0 && <div className="px-3 py-3 text-sm text-gray-500">No groups found.</div>}
            </div>
            <div className="flex justify-end">
              <button type="button" className="btn-secondary" onClick={() => { setOpen(false); setQ('') }}>Close</button>
            </div>

            <QuickCreateLocalGroupModal
              open={showCreateGroup}
              onClose={() => setShowCreateGroup(false)}
              onCreated={(createdGroup) => {
                setPickerGroups(prev => [...prev, createdGroup])
                onChange(createdGroup.id)
                setShowCreateGroup(false)
                setOpen(false)
                setQ('')
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}

function UserDetailModal({ user: u, onClose, onEdit }) {
  const hasFullAccess = u.role === 'admin' || u.role === 'superadmin'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50 dark:bg-gray-700/50">
          <div className="flex items-center gap-2">
            {u.role === 'superadmin' ? <Shield size={16} className="text-purple-500" /> : <User size={16} className="text-gray-400" />}
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">{u.username}</h2>
            {u.display_name && u.display_name !== u.username && <span className="text-sm text-gray-400">{u.display_name}</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <RoleBadge role={u.role} />
            <AuthBadge authType={u.auth_type} />
            {u.is_active
              ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">Active</span>
              : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-400 border border-gray-200 font-medium">Disabled</span>
            }
          </div>
          {u.email && <p className="text-sm text-gray-500">{u.email}</p>}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Permissions</p>
            {hasFullAccess ? (
              <div className="flex items-center gap-2 text-sm text-green-700 font-medium">
                <CheckCircle size={15} className="text-green-500" />
                Full access to all sections
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-4">
                {ALL_PERMS.map(p => {
                  const granted = !!u.permissions?.[p.key]
                  return (
                    <div key={p.key} className="flex items-center gap-1.5 text-xs">
                      {granted
                        ? <CheckCircle size={13} className="text-green-500 flex-shrink-0" />
                        : <XCircle size={13} className="text-red-400 flex-shrink-0" />}
                      <span className={granted ? 'text-gray-800 dark:text-gray-200 font-medium' : 'text-gray-400'}>{p.label}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50 dark:bg-gray-700/50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Close</button>
          {u.role !== 'superadmin' && u.auth_type !== 'ldap' && onEdit && (
            <button onClick={() => { onClose(); onEdit(u) }}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">
              Edit user
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function EditPermissionsModal({ user: u, roleOptions, roleProfiles, localGroups, onClose, onSaved }) {
  const [username, setUsername] = useState(u.username || '')
  const [displayName, setDisplayName] = useState(u.display_name || '')
  const [email, setEmail] = useState(u.email || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [role, setRole] = useState(u.role)
  const [permissions, setPermissions] = useState(mergeWithRoleBaseline(u.role, u.permissions || {}, roleProfiles))
  const [groupId, setGroupId] = useState('')
  const [saving, setSaving] = useState(false)

  // Load current group membership for this user
  useEffect(() => {
    usersApi.get(u.id).then(r => {
      const groups = r.data?.groups || []
      setGroupId(groups[0]?.id || '')
    }).catch(() => {})
  }, [u.id])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username.trim()) { toast.error('Username is required'); return }
    if (!displayName.trim()) { toast.error('Display name is required'); return }
    if (!email.trim()) { toast.error('Email is required'); return }
    if (!role) { toast.error('Role is required'); return }
    if (!groupId) { toast.error('Group is required'); return }
    if (password && !confirmPassword) { toast.error('Please confirm the new password'); return }
    if (password && password !== confirmPassword) { toast.error('Passwords do not match'); return }
    if (password && !passwordPolicyOk(password)) {
      toast.error('Password does not meet minimum security requirements')
      return
    }
    setSaving(true)
    try {
      await usersApi.update(u.id, {
        username: username.trim(),
        display_name: displayName.trim(),
        email: email.trim(),
        ...(password ? { password } : {}),
        role,
        permissions: (role === 'admin' || role === 'superadmin') ? {} : permissions,
        group_id: groupId,
      })
      toast.success('User updated')
      onSaved()
      onClose()
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
    finally { setSaving(false) }
  }

  const handleGeneratePassword = () => {
    const generated = generateStrongPassword()
    setPassword(generated)
    setConfirmPassword(generated)
    toast.success('Password generated')
  }

  return (
    <Modal title={`Edit user: ${u.username}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Username *</label>
            <input className="input" required value={username} onChange={e => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Display name *</label>
            <input className="input" required value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Email *</label>
          <input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">New password</label>
          <div className="flex items-center gap-2">
            <input className="input" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave empty to keep current password" />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowPassword(v => !v)}
              title={showPassword ? 'Hide password' : 'Show password'}
              aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button type="button" className="btn-secondary whitespace-nowrap" onClick={handleGeneratePassword}>
              <Wand2 size={14} />
              Generate
            </button>
          </div>
          <PasswordRequirements password={password} optional />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Confirm new password</label>
          <div className="flex items-center gap-2">
            <input className="input" type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Repeat new password" />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowConfirmPassword(v => !v)}
              title={showConfirmPassword ? 'Hide password' : 'Show password'}
              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}>
              {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        <LocalGroupPicker groups={localGroups} value={groupId} onChange={setGroupId} required />
        <div>
          <label className="block text-sm font-medium mb-1">Role *</label>
          <select className="input" required value={role} onChange={e => {
            const nextRole = e.target.value
            const prevRole = role
            setRole(nextRole)
            setPermissions(prev => rebaseRolePermissions(prevRole, nextRole, prev, roleProfiles))
          }}>
            {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Permissions {(role === 'admin' || role === 'superadmin') && <span className="text-gray-400 font-normal ml-1">(full access)</span>}
          </label>
          <PermissionsEditor
            value={permissions}
            onChange={setPermissions}
            disabled={role === 'admin' || role === 'superadmin'}
            lockedKeys={roleBaselineLockedKeys(role, roleProfiles)}
          />
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}

// â”€â”€â”€ Tab Utenti â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function UsersTab({ roleOptions, roleProfiles }) {
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [authFilter, setAuthFilter] = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [detail, setDetail] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [localGroups, setLocalGroups] = useState([])
  const [showCreatePassword, setShowCreatePassword] = useState(false)
  const [showCreateConfirmPassword, setShowCreateConfirmPassword] = useState(false)
  const [form, setForm] = useState({ username: '', display_name: '', email: '', password: '', confirm_password: '', role: 'operator', permissions: {}, group_id: '' })

  useEffect(() => {
    setForm(f => ({ ...f, permissions: mergeWithRoleBaseline(f.role, f.permissions, roleProfiles) }))
  }, [roleProfiles])

  useEffect(() => {
    groupsApi.list().then(r => {
      // keep only local groups (no ldap mappings needed here; just show all)
      setLocalGroups(r.data || [])
    }).catch(() => {})
  }, [])

  const load = () => usersApi.list({ page, limit }).then(r => {
    const list = Array.isArray(r.data) ? r.data : (r.data.data || [])
    const tot  = Array.isArray(r.data) ? r.data.length : (r.data.total || r.data.length || 0)
    setUsers(list); setTotal(tot)
  })
  useEffect(() => { load() }, [page, limit])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!form.group_id) { toast.error('Group is required'); return }
    if (!form.confirm_password) { toast.error('Please confirm the password'); return }
    if (form.password !== form.confirm_password) { toast.error('Passwords do not match'); return }
    if (!passwordPolicyOk(form.password)) {
      toast.error('Password does not meet minimum security requirements')
      return
    }
    try {
      const payload = { ...form, permissions: mergeWithRoleBaseline(form.role, form.permissions, roleProfiles) }
      delete payload.confirm_password
      if (form.role === 'admin') payload.permissions = {}
      await usersApi.create(payload); toast.success('User created'); setShowCreate(false)
      setForm({ username: '', display_name: '', email: '', password: '', confirm_password: '', role: 'operator', permissions: {}, group_id: '' }); load()
    }
    catch (err) { toast.error(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Error') }
  }

  const handleGenerateCreatePassword = () => {
    const generated = generateStrongPassword()
    setForm(f => ({ ...f, password: generated, confirm_password: generated }))
    toast.success('Password generated')
  }

  const handleDelete = async () => {
    try { await usersApi.delete(deleteTarget.id); toast.success('User deleted'); setDeleteTarget(null); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const filtered = authFilter === 'all' ? users : users.filter(u => u.auth_type === authFilter)
  const hasFullAccess = (u) => u.role === 'admin' || u.role === 'superadmin'
  const formatLastLogin = (value) => {
    if (!value) return 'Never'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Never'
    return date.toLocaleString()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Type:</span>
          {['all','local','ldap'].map(f => (
            <button key={f} onClick={() => { setAuthFilter(f); if (f !== 'local') setShowCreate(false) }}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${authFilter === f ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {f === 'all' ? 'All' : f.toUpperCase()}
            </button>
          ))}
          {authFilter !== 'all' && <span className="text-xs text-gray-400">({filtered.length} shown)</span>}
        </div>
        {authFilter === 'local' && (
          <button className="btn-primary" onClick={() => { setShowCreatePassword(false); setShowCreateConfirmPassword(false); setShowCreate(true) }}><Plus size={15} />New User</button>
        )}
      </div>

      <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="min-w-[640px] w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>{['Username','Display name','Email','Auth','Role','Active','Last login','Actions'].map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map(u => (
              <tr key={u.id}
                className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer select-none"
                onDoubleClick={() => setDetail(u)}
                title="Double click for details">
                <td className="px-4 py-3 font-mono text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block w-2 h-2 rounded-full ${authAccentClass(u.auth_type)}`} />
                    {u.role === 'superadmin' ? <Shield size={13} className="text-purple-500" /> : <User size={13} className="text-gray-400" />}
                    {u.username}
                  </div>
                </td>
                <td className="px-4 py-3">{u.display_name}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                <td className="px-4 py-3"><AuthBadge authType={u.auth_type} /></td>
                <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                <td className="px-4 py-3 text-xs">
                  {u.is_active
                    ? <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">Active</span>
                    : <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200 font-medium">Disabled</span>
                  }
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{formatLastLogin(u.last_login_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    {u.role !== 'superadmin' && u.auth_type !== 'ldap' && (
                      <button className="action-icon-btn" onClick={e => { e.stopPropagation(); setEditTarget(u) }} title="Edit"><Pencil size={14} /></button>
                    )}
                    <button className="action-icon-btn action-icon-btn-danger" onClick={e => { e.stopPropagation(); setDeleteTarget(u) }}><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-500">No users</td></tr>}
          </tbody>
        </table>
        </div>
        <div className="p-4"><Pagination page={page} limit={limit} total={total} onChange={setPage} onLimitChange={setLimit} /></div>
      </div>

      {detail && (
        <UserDetailModal user={detail} onClose={() => setDetail(null)} onEdit={u => { setDetail(null); setEditTarget(u) }} />
      )}

      {editTarget && (
        <EditPermissionsModal user={editTarget} roleOptions={roleOptions} roleProfiles={roleProfiles} localGroups={localGroups} onClose={() => setEditTarget(null)} onSaved={load} />
      )}

      <QuickCreateUserModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false)
          load()
        }}
        localGroups={localGroups}
        initialRoleOptions={roleOptions}
        initialRoleProfiles={roleProfiles}
      />

      {deleteTarget && (
        <ConfirmDialog title="Delete user" message={`Delete "${deleteTarget.display_name}"?`} danger confirmLabel="Delete"
          onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
      )}
    </div>
  )
}

// â”€â”€â”€ Tab Gruppi Locali â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function GroupsTab({ roleOptions, roleProfiles }) {
  const [groupType, setGroupType] = useState('all')
  const [groups, setGroups] = useState([])
  const [allMappings, setAllMappings] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [createType, setCreateType] = useState('local')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [detailGroup, setDetailGroup] = useState(null)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(25)
  const [form, setForm] = useState({ name: '', description: '', role: 'viewer', permissions: {} })
  const [ldapCreateForm, setLdapCreateForm] = useState({ name: '', description: '', role: 'viewer', permissions: {}, ldapGroup: null })
  const [memberInput, setMemberInput] = useState('')
  const [editPerms, setEditPerms] = useState(false)
  const [editGroupRole, setEditGroupRole] = useState('viewer')
  const [editPermsData, setEditPermsData] = useState({})
  const [ldapMappingSearch, setLdapMappingSearch] = useState('')
  const [ldapMappingResults, setLdapMappingResults] = useState([])
  const [ldapMappingLoading, setLdapMappingLoading] = useState(false)
  const [ldapCreateSearch, setLdapCreateSearch] = useState('')
  const [ldapCreateResults, setLdapCreateResults] = useState([])
  const [ldapCreateLoading, setLdapCreateLoading] = useState(false)

  useEffect(() => {
    setForm(f => ({ ...f, permissions: mergeWithRoleBaseline(f.role, f.permissions, roleProfiles) }))
    setLdapCreateForm(f => ({ ...f, permissions: mergeWithRoleBaseline(f.role, f.permissions, roleProfiles) }))
  }, [roleProfiles])

  const load = async () => {
    const [groupsRes, mappingsRes] = await Promise.all([
      groupsApi.list(),
      groupsApi.ldapMappings(),
    ])
    setGroups(groupsRes.data || [])
    setAllMappings(mappingsRes.data || [])
  }
  const openDetail = (id, startEdit = false) => groupsApi.get(id).then(r => {
    const group = r.data
    setDetailGroup(group)
    if (startEdit) {
      const role = group?.role || 'viewer'
      setEditGroupRole(role)
      setEditPermsData(mergeWithRoleBaseline(role, group?.permissions || {}, roleProfiles))
      setEditPerms(true)
    } else {
      setEditPerms(false)
    }
  })
  useEffect(() => { load() }, [])

  const ldapGroupIds = new Set((allMappings || []).map(m => String(m.local_group_id || '').toLowerCase()).filter(Boolean))
  const groupsWithType = groups.map(g => {
    const fromMappings = ldapGroupIds.has(String(g.id || '').toLowerCase())
    const fromCount = Number(g.ldap_mapping_count || 0) > 0
    return { ...g, type: (fromMappings || fromCount) ? 'ldap' : 'local' }
  })
  const filteredGroups = groupType === 'all' ? groupsWithType : groupsWithType.filter(g => g.type === groupType)
  const pagedGroups = filteredGroups.slice((page - 1) * limit, page * limit)
  const detailGroupType = detailGroup && (ldapGroupIds.has(String(detailGroup.id || '').toLowerCase()) || Number(detailGroup.ldap_mapping_count || 0) > 0) ? 'ldap' : 'local'
  const mappingsByGroup = (groupId) => (allMappings || []).filter(m => m.local_group_id === groupId)

  const handleCreate = async (e) => {
    e.preventDefault()
    try { await groupsApi.create(form); toast.success('Group created'); setShowCreate(false); setForm({ name: '', description: '', role: 'viewer', permissions: {} }); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const handleDelete = async () => {
    try { await groupsApi.delete(deleteTarget.id); toast.success('Deleted'); setDeleteTarget(null); if (detailGroup?.id === deleteTarget.id) setDetailGroup(null); load() }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const handleAddMember = async (e) => {
    e.preventDefault()
    try { await groupsApi.addMember(detailGroup.id, memberInput); toast.success('Member added'); setMemberInput(''); openDetail(detailGroup.id) }
    catch (err) { toast.error(err.response?.data?.error || 'Invalid user ID') }
  }

  const handleRemoveMember = async (userId) => {
    try { await groupsApi.removeMember(detailGroup.id, userId); openDetail(detailGroup.id) }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const handleSaveGroupPerms = async () => {
    try {
      await groupsApi.update(detailGroup.id, { role: editGroupRole, permissions: editPermsData })
      toast.success('Group updated')
      setEditPerms(false)
      await load()
      openDetail(detailGroup.id)
    }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const searchLdapGroups = async (q, onResults, onLoading, setSearchValue) => {
    setSearchValue(q)
    const cleaned = String(q || '').trim()
    if (!cleaned || cleaned.length < 1) { onResults([]); return }
    onLoading(true)
    try {
      const r = await settingsApi.searchLdapGroups(cleaned)
      onResults(r.data || [])
    } catch {
      onResults([])
    } finally {
      onLoading(false)
    }
  }

  const handleLdapMappingSearch = async (q) => {
    await searchLdapGroups(q, setLdapMappingResults, setLdapMappingLoading, setLdapMappingSearch)
  }

  const handleLdapCreateSearch = async (q) => {
    await searchLdapGroups(q, setLdapCreateResults, setLdapCreateLoading, setLdapCreateSearch)
  }

  const handleAddLdapMapping = async (ldapGroup) => {
    try {
      await groupsApi.addLdapMapping({ ldap_group_dn: ldapGroup.dn, local_group_id: detailGroup.id, role: detailGroup.role || 'viewer' })
      toast.success('LDAP mapping added')
      setLdapMappingSearch(''); setLdapMappingResults([])
      await load()
      openDetail(detailGroup.id)
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const handleDeleteLdapMapping = async (mappingId) => {
    // Block removal of the last mapping for an LDAP group
    const currentMappings = (detailGroup?.ldapMappings || [])
    if (currentMappings.length <= 1) {
      toast.error('Cannot remove the only LDAP mapping. Delete the group if you no longer need it.')
      return
    }
    try {
      await groupsApi.deleteLdapMapping(mappingId)
      toast.success('Mapping removed')
      await load()
      if (detailGroup?.id) await openDetail(detailGroup.id)
    }
    catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const resolveTypedLdapGroup = async () => {
    if (ldapCreateForm.ldapGroup?.dn) return ldapCreateForm.ldapGroup

    const typed = String(ldapCreateSearch || '').trim()
    if (!typed) return null

    // Accept direct DN paste as mapping value.
    if (typed.includes('=') && typed.includes(',')) {
      return { dn: typed, name: typed }
    }

    const r = await settingsApi.searchLdapGroups(typed)
    const list = Array.isArray(r.data) ? r.data : []
    if (list.length === 0) return null

    const norm = typed.toLowerCase()
    const exact = list.find(g =>
      String(g.name || '').toLowerCase() === norm ||
      String(g.samAccountName || '').toLowerCase() === norm ||
      String(g.dn || '').toLowerCase() === norm
    )

    // If query returns multiple matches and none is exact, use the first AD result.
    return exact || list[0] || null
  }

  const handleCreateLdapGroup = async (e) => {
    e.preventDefault()
    const resolvedLdapGroup = await resolveTypedLdapGroup()
    if (!resolvedLdapGroup?.dn) {
      toast.error('LDAP group not found for the given query')
      return
    }
    try {
      const groupRes = await groupsApi.create({
        name: ldapCreateForm.name,
        description: ldapCreateForm.description,
        role: ldapCreateForm.role,
        permissions: ldapCreateForm.permissions,
      })
      await groupsApi.addLdapMapping({
        ldap_group_dn: resolvedLdapGroup.dn,
        local_group_id: groupRes.data?.id,
        role: ldapCreateForm.role,
      })
      toast.success('LDAP group created')
      setShowCreate(false)
      setLdapCreateForm({ name: '', description: '', role: 'viewer', permissions: {}, ldapGroup: null })
      setLdapCreateSearch('')
      setLdapCreateResults([])
      await load()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Type:</span>
          {['all', 'local', 'ldap'].map(m => (
            <button key={m} onClick={() => { setGroupType(m); setPage(1); setShowCreate(false); setDetailGroup(null) }}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${groupType === m ? 'bg-brand-600 text-white border-brand-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {m.toUpperCase()}
            </button>
          ))}
          <span className="text-xs text-gray-400">({filteredGroups.length} shown / {groupsWithType.length} total)</span>
        </div>
        {groupType !== 'all' && (
          <button className="btn-primary" onClick={() => { setCreateType(groupType === 'ldap' ? 'ldap' : 'local'); setShowCreate(true) }}>
            <Plus size={15} />{(groupType === 'ldap' || createType === 'ldap') ? 'New LDAP Group' : 'New Group'}
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                {['Name','Description','Type','Role','Members','']
                  .map(h => <th key={h} className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-300">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {pagedGroups.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-gray-500">No groups</td></tr>
              )}
              {pagedGroups.map(g => (
                <tr key={g.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer" onDoubleClick={() => openDetail(g.id)} title="Double click for details">
                  <td className="px-4 py-3 font-medium flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${g.type === 'ldap' ? 'bg-sky-500' : 'bg-emerald-500'}`} />
                    <UsersIcon size={15} className="text-gray-400 flex-shrink-0" />
                    {g.name}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{g.description || <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3"><AuthBadge authType={g.type} /></td>
                  <td className="px-4 py-3"><RoleBadge role={g.role || 'viewer'} /></td>
                  {g.type === 'local' ? (
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700">
                        {g.member_count ?? '—'}
                      </span>
                    </td>
                  ) : (
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-sky-100 text-sky-700">
                        {mappingsByGroup(g.id).length}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button className="action-icon-btn" onClick={e => { e.stopPropagation(); openDetail(g.id, true) }} title="Edit"><Pencil size={14} /></button>
                      <button className="action-icon-btn action-icon-btn-danger" onClick={e => { e.stopPropagation(); setDeleteTarget(g) }} title="Delete"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4">
          <Pagination
            page={page}
            limit={limit}
            total={filteredGroups.length}
            onChange={setPage}
            onLimitChange={(v) => { setLimit(Math.min(25, v)); setPage(1) }}
          />
        </div>
      </div>

      {/* Group detail modal */}
      {detailGroup && (
        <Modal title={detailGroup.name} onClose={() => setDetailGroup(null)}>
          <div className="space-y-5">
            {detailGroup.description && <p className="text-sm text-gray-500">{detailGroup.description}</p>}

            {/* Danger zone: delete group */}
            <div className="flex justify-end">
              <button
                className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 border border-red-200 hover:border-red-400 px-3 py-1 rounded-lg transition-colors"
                onClick={() => { setDetailGroup(null); setDeleteTarget({ id: detailGroup.id, name: detailGroup.name }) }}>
                <Trash2 size={12} />Delete group
              </button>
            </div>

            {/* Permissions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold">Role & Permissions</p>
                {!editPerms ? (
                  <button className="action-text-btn"
                    onClick={() => {
                      const r = detailGroup.role || 'viewer'
                      setEditGroupRole(r)
                      setEditPermsData(mergeWithRoleBaseline(r, detailGroup.permissions || {}, roleProfiles))
                      setEditPerms(true)
                    }}>
                    <Pencil size={12} />Edit
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button className="action-text-btn text-green-700 dark:text-green-300" onClick={handleSaveGroupPerms}>Save</button>
                    <button className="action-text-btn" onClick={() => setEditPerms(false)}>Cancel</button>
                  </div>
                )}
              </div>
              {editPerms ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Role *</label>
                    <select className="input" value={editGroupRole} onChange={e => {
                      const nextRole = e.target.value
                      const prevRole = editGroupRole
                      setEditGroupRole(nextRole)
                      setEditPermsData(prev => rebaseRolePermissions(prevRole, nextRole, prev, roleProfiles))
                    }}>
                      {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <PermissionsEditor value={editPermsData} onChange={setEditPermsData} disabled={false} lockedKeys={roleBaselineLockedKeys(editGroupRole, roleProfiles)} />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-sm"><span className="text-gray-500">Role:</span> <span className="ml-1"><RoleBadge role={detailGroup.role || 'viewer'} /></span></div>
                  <div className="grid grid-cols-2 gap-y-1 gap-x-4">
                    {ALL_PERMS.map(p => {
                      const granted = !!(detailGroup.permissions || {})[p.key]
                      return (
                        <div key={p.key} className="flex items-center gap-1.5 text-xs">
                          {granted ? <CheckCircle size={12} className="text-green-500 flex-shrink-0" /> : <XCircle size={12} className="text-red-300 flex-shrink-0" />}
                          <span className={granted ? 'text-gray-700 dark:text-gray-200 font-medium' : 'text-gray-400'}>{p.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {detailGroupType === 'local' && (
              <div>
                <p className="text-sm font-semibold mb-2">Members ({detailGroup.members?.length || 0})</p>
                <div className="mb-2 flex items-center gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    Local: {(detailGroup.members || []).filter(m => (m.auth_type || 'local') !== 'ldap').length}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    LDAP: {(detailGroup.members || []).filter(m => m.auth_type === 'ldap').length}
                  </span>
                </div>
                <form onSubmit={handleAddMember} className="flex gap-2 mb-3">
                  <input className="input flex-1 text-sm" placeholder="User ID or username to add" value={memberInput} onChange={e => setMemberInput(e.target.value)} />
                  <button type="submit" className="btn-primary text-xs"><Plus size={13} />Add</button>
                </form>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {(detailGroup.members || []).map(m => (
                    <div key={m.user_id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <User size={13} className="text-gray-400" />
                        <span className="truncate">{m.username || m.user_id}</span>
                        <AuthBadge authType={m.auth_type || 'local'} />
                      </div>
                      <button className="text-xs text-red-500 hover:text-red-700 px-2 py-0.5 rounded hover:bg-red-50" onClick={() => handleRemoveMember(m.user_id)}>Remove</button>
                    </div>
                  ))}
                  {(!detailGroup.members || detailGroup.members.length === 0) && <p className="text-sm text-gray-400 py-2 text-center">No members</p>}
                </div>
              </div>
            )}

            {detailGroupType === 'ldap' && (
              <div>
                <p className="text-sm font-semibold mb-2">LDAP Mappings</p>
                <div className="relative mb-3">
                  <input className="input text-sm" placeholder="Search LDAP group (name, sAMAccountName or DN)..."
                    value={ldapMappingSearch}
                    onChange={e => handleLdapMappingSearch(e.target.value)} />
                  {ldapMappingResults.length > 0 && (
                    <div className="absolute z-10 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {ldapMappingResults.map(g => (
                        <button key={g.dn} type="button"
                          onClick={() => handleAddLdapMapping(g)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 dark:hover:bg-gray-700">
                          <span className="font-medium">{g.name}</span>
                          {g.description && <span className="text-xs text-gray-400 ml-2">{g.description}</span>}
                          <span className="block text-xs text-gray-400 font-mono truncate">{g.dn}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  {(!detailGroup.ldapMappings || detailGroup.ldapMappings.length === 0) && <p className="text-sm text-gray-400 text-center py-2">No LDAP mappings configured</p>}
                  {(detailGroup.ldapMappings || []).map(m => (
                    <div key={m.id} className="flex items-center justify-between p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                      <span className="text-xs font-mono text-blue-700 dark:text-blue-300 truncate flex-1 mr-2">{m.ldap_group_dn}</span>
                      <button className="text-xs text-red-500 hover:text-red-700 px-2 py-0.5 rounded hover:bg-red-50 flex-shrink-0" onClick={() => handleDeleteLdapMapping(m.id)}>Remove</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      <QuickCreateLocalGroupModal
        open={showCreate && createType === 'local'}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false)
          load()
        }}
        initialRoleOptions={roleOptions}
        initialRoleProfiles={roleProfiles}
      />

      {showCreate && createType === 'ldap' && (
        <Modal title="New LDAP Group" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreateLdapGroup} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Name *</label><input className="input" required value={ldapCreateForm.name} onChange={e => setLdapCreateForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">Description</label><input className="input" value={ldapCreateForm.description} onChange={e => setLdapCreateForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">Role *</label>
              <select className="input" required value={ldapCreateForm.role} onChange={e => setLdapCreateForm(f => ({ ...f, role: e.target.value, permissions: rebaseRolePermissions(f.role, e.target.value, f.permissions, roleProfiles) }))}>
                {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Permissions</label>
              <PermissionsEditor value={ldapCreateForm.permissions} onChange={p => setLdapCreateForm(f => ({ ...f, permissions: p }))} disabled={false} lockedKeys={roleBaselineLockedKeys(ldapCreateForm.role, roleProfiles)} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">LDAP Group Mapping *</label>
              <div className="relative">
                <input className="input text-sm" placeholder="Search LDAP group (name, sAMAccountName or DN)..." value={ldapCreateSearch} onChange={e => handleLdapCreateSearch(e.target.value)} />
                {ldapCreateResults.length > 0 && (
                  <div className="absolute z-10 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {ldapCreateResults.map(g => (
                      <button key={g.dn} type="button" onClick={() => { setLdapCreateForm(f => ({ ...f, ldapGroup: g })); setLdapCreateSearch(g.name || g.dn); setLdapCreateResults([]) }} className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50 dark:hover:bg-gray-700">
                        <span className="font-medium">{g.name}</span>
                        {g.description && <span className="text-xs text-gray-400 ml-2">{g.description}</span>}
                        <span className="block text-xs text-gray-400 font-mono truncate">{g.dn}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {ldapCreateForm.ldapGroup?.dn && (
                <div className="mt-2 p-2 rounded bg-blue-50 dark:bg-blue-900/20 text-xs">
                  <span className="font-medium text-blue-800 dark:text-blue-200">Selected:</span>
                  <span className="block text-blue-700 dark:text-blue-300 font-mono truncate">{ldapCreateForm.ldapGroup.dn}</span>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Create</button>
            </div>
          </form>
        </Modal>
      )}
      {deleteTarget && <ConfirmDialog title="Delete Group" message={`Delete "${deleteTarget.name}"?`} danger confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />}
    </div>
  )
}

// --- Tab Roles ---
function RolesTab() {
  const [presets, setPresets] = useState([])
  const [saving, setSaving] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', description: '', permissions: {} })
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [editingPermissions, setEditingPermissions] = useState({})

  const load = () => settingsApi.getRolePresets().then(r => setPresets(r.data || []))
  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    const id = crypto.randomUUID()
    const updated = [...presets, { id, ...newForm }]
    setSaving(true)
    try {
      await settingsApi.saveRolePresets(updated)
      toast.success('Role preset created')
      setPresets(updated)
      setShowCreate(false)
      setNewForm({ name: '', description: '', permissions: {} })
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    const updated = presets.filter(p => p.id !== deleteTarget.id)
    try {
      await settingsApi.saveRolePresets(updated)
      toast.success('Deleted')
      setPresets(updated)
      setDeleteTarget(null)
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const handleUpdatePerms = async (preset, permissions) => {
    const updated = presets.map(p => p.id === preset.id ? { ...p, permissions } : p)
    try {
      await settingsApi.saveRolePresets(updated)
      setPresets(updated)
    } catch (err) { toast.error(err.response?.data?.error || 'Error') }
  }

  const beginEdit = (preset) => {
    setEditTarget(preset)
    setEditingPermissions(preset.permissions || {})
  }

  const cancelEdit = () => {
    setEditTarget(null)
    setEditingPermissions({})
  }

  const saveEdit = async () => {
    if (!editTarget) return
    await handleUpdatePerms(editTarget, editingPermissions)
    cancelEdit()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">Role Presets</h3>
          <p className="text-sm text-gray-500">Permission presets that can be applied to users</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} />New Preset</button>
      </div>

      {presets.length === 0 && (
        <div className="card p-8 text-center text-gray-400 text-sm">No role presets defined</div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                {['Role', 'Description', 'Permissions', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-medium text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {presets.map(preset => (
                <tr
                  key={preset.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  onDoubleClick={() => beginEdit(preset)}
                  title="Double click to edit permissions"
                >
                  <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-100">{preset.name}</td>
                  <td className="px-4 py-3 text-gray-500">{preset.description || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{Object.values(preset.permissions || {}).filter(Boolean).length}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button className="action-icon-btn" onClick={() => beginEdit(preset)} title="Edit permissions"><Pencil size={14} /></button>
                      <button className="action-icon-btn action-icon-btn-danger" onClick={() => setDeleteTarget(preset)} title="Delete role"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editTarget && (
        <Modal title={`Edit Permissions: ${editTarget.name}`} onClose={cancelEdit}>
          <div className="space-y-4">
            <PermissionsEditor value={editingPermissions} onChange={setEditingPermissions} disabled={false} />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={cancelEdit}>Cancel</button>
              <button type="button" className="btn-primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </Modal>
      )}

      {showCreate && (
        <Modal title="New Role Preset" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div><label className="block text-sm font-medium mb-1">Name *</label>
              <input className="input" required value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">Description</label>
              <input className="input" value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">Permissions</label>
              <PermissionsEditor value={newForm.permissions} onChange={p => setNewForm(f => ({ ...f, permissions: p }))} disabled={false} /></div>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog title="Delete Preset" message={`Delete "${deleteTarget.name}"?`} danger confirmLabel="Delete"
          onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />
      )}
    </div>
  )
}

// â”€â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function Users() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'users'
  const [roleOptions, setRoleOptions] = useState(DEFAULT_ROLES)
  const [roleProfiles, setRoleProfiles] = useState({})

  useEffect(() => {
    settingsApi.getRolePresets()
      .then(r => {
        setRoleOptions(extractRoleOptions(r.data || []))
        setRoleProfiles(extractRoleProfiles(r.data || []))
      })
      .catch(() => {
        setRoleOptions(DEFAULT_ROLES)
        setRoleProfiles({})
      })
  }, [])

  return (
    <Layout title="Users & Groups">
      <div className="space-y-6">
        {/* Tabs */}
        <div className="py-2 -mx-4 sm:mx-0 px-4 sm:px-0 border-b border-gray-200 dark:border-gray-700">
          <nav className="flex flex-wrap gap-1.5">
            {TABS.map(t => {
              const Icon = t.icon
              return (
                <button key={t.id} onClick={() => setSearchParams({ tab: t.id })}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-full transition-colors ${
                    tab === t.id ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}>
                  <Icon size={14} />{t.label}
                </button>
              )
            })}
          </nav>
        </div>

        {tab === 'users' && <UsersTab roleOptions={roleOptions} roleProfiles={roleProfiles} />}
        {tab === 'groups' && <GroupsTab roleOptions={roleOptions} roleProfiles={roleProfiles} />}
        {tab === 'roles' && <RolesTab />}
      </div>
    </Layout>
  )
}

