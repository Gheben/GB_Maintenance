import { useEffect, useState } from 'react'
import { CheckCircle, Eye, EyeOff, Wand2, XCircle } from 'lucide-react'
import { usersApi, groupsApi, settingsApi } from '../api'
import { Modal } from './Modal'
import { toast } from './Toast'

const DEFAULT_ROLES = ['admin', 'change_manager', 'operator', 'viewer', 'subscriber']
const ALL_PERMS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'assets', label: 'Assets' },
  { key: 'services', label: 'Services' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'incidents', label: 'Incidents' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'status_page', label: 'Status Page' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'reports', label: 'Reports' },
  { key: 'users', label: 'Users & Groups' },
  { key: 'settings', label: 'Settings' },
  { key: 'apikeys', label: 'API Keys' },
  { key: 'audit', label: 'Audit Log' },
]
const PASSWORD_RULES = [
  { key: 'len', label: 'At least 8 characters', test: (v) => String(v || '').length >= 8 },
  { key: 'upper', label: 'At least 1 uppercase letter (A-Z)', test: (v) => /[A-Z]/.test(String(v || '')) },
  { key: 'num', label: 'At least 1 number (0-9)', test: (v) => /[0-9]/.test(String(v || '')) },
  { key: 'special', label: 'At least 1 special character', test: (v) => /[^A-Za-z0-9]/.test(String(v || '')) },
]

function extractRoleOptions(presets) {
  const roles = Array.isArray(presets)
    ? presets.map(p => String(p?.name || p?.id || '').trim()).filter(Boolean)
    : []
  return [...new Set([...DEFAULT_ROLES, ...roles])]
}

function extractRoleProfiles(presets) {
  const map = {}
  if (Array.isArray(presets)) {
    for (const preset of presets) {
      const key = String(preset?.name || preset?.id || '').trim()
      if (key) map[key] = preset?.permissions && typeof preset.permissions === 'object' ? preset.permissions : {}
    }
  }
  return map
}

function mergeWithRoleBaseline(role, currentPermissions, roleProfiles) {
  const baseline = roleProfiles?.[role] || {}
  const current = currentPermissions || {}
  const merged = {}
  for (const key of Object.keys(baseline)) {
    if (baseline[key]) merged[key] = true
  }
  for (const key of Object.keys(current)) {
    if (current[key]) merged[key] = true
  }
  return merged
}

function roleBaselineLockedKeys(role, roleProfiles) {
  const baseline = roleProfiles?.[role] || {}
  return new Set(Object.keys(baseline).filter(key => !!baseline[key]))
}

function rebaseRolePermissions(prevRole, nextRole, currentPermissions, roleProfiles) {
  const prevLocked = roleBaselineLockedKeys(prevRole, roleProfiles)
  const current = currentPermissions || {}
  const extras = {}
  for (const key of Object.keys(current)) {
    if (current[key] && !prevLocked.has(key)) extras[key] = true
  }
  return mergeWithRoleBaseline(nextRole, extras, roleProfiles)
}

function passwordPolicyOk(password) {
  return PASSWORD_RULES.every(rule => rule.test(password))
}

function getPasswordStrength(password) {
  const value = String(password || '')
  if (!value) return { score: 0, level: 'none', label: '' }
  const baseScore = PASSWORD_RULES.reduce((acc, rule) => acc + (rule.test(value) ? 1 : 0), 0)
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
  const pick = chars => chars[Math.floor(Math.random() * chars.length)]
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)]
  for (let i = chars.length; i < Math.max(8, length); i += 1) chars.push(pick(all))
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
  const checks = PASSWORD_RULES.map(rule => ({ ...rule, ok: rule.test(value) }))
  const strength = getPasswordStrength(value)
  const strengthWidth = `${Math.min(100, Math.max(10, (strength.score / 5) * 100))}%`
  const strengthBarClass = strength.level === 'strong' ? 'bg-green-500' : strength.level === 'medium' ? 'bg-amber-500' : 'bg-red-500'
  const strengthTextClass = strength.level === 'strong' ? 'text-green-600 dark:text-green-400' : strength.level === 'medium' ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'

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
        {checks.map(rule => (
          <li key={rule.key} className={`text-xs flex items-center gap-1.5 ${rule.ok ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
            {rule.ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
            <span>{rule.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PermissionsEditor({ value, onChange, disabled, lockedKeys = new Set() }) {
  return (
    <div className="grid grid-cols-2 gap-2 mt-2">
      {ALL_PERMS.map(permission => (
        <label key={permission.key} className={`flex items-center gap-2 text-sm cursor-pointer select-none ${(disabled || lockedKeys.has(permission.key)) ? 'opacity-40 pointer-events-none' : ''}`}>
          <input
            type="checkbox"
            checked={!!value[permission.key]}
            onChange={() => onChange({ ...value, [permission.key]: !value[permission.key] })}
            disabled={disabled || lockedKeys.has(permission.key)}
            className="accent-blue-600"
          />
          {permission.label}
        </label>
      ))}
    </div>
  )
}

function LocalGroupPicker({ groups, value, onChange, required, roleOptions, roleProfiles }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pickerGroups, setPickerGroups] = useState(groups || [])
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const localGroups = pickerGroups.filter(group => !group.ldap_mapping_count || group.ldap_mapping_count === 0)
  const selected = localGroups.find(group => group.id === value)
  const filtered = q.trim() ? localGroups.filter(group => String(group.name || '').toLowerCase().includes(q.trim().toLowerCase())) : localGroups

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
              {filtered.map(group => (
                <button
                  key={group.id}
                  type="button"
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 ${value === group.id ? 'bg-brand-50 text-brand-700' : ''}`}
                  onClick={() => {
                    onChange(group.id)
                    setOpen(false)
                    setQ('')
                  }}
                >
                  {group.name}
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
              initialRoleOptions={roleOptions}
              initialRoleProfiles={roleProfiles}
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

export function QuickCreateUserModal({ open, onClose, onCreated, localGroups = [], initialRoleOptions, initialRoleProfiles }) {
  const [saving, setSaving] = useState(false)
  const [roleOptions, setRoleOptions] = useState(initialRoleOptions?.length ? initialRoleOptions : DEFAULT_ROLES)
  const [roleProfiles, setRoleProfiles] = useState(initialRoleProfiles || {})
  const [pickerGroups, setPickerGroups] = useState(localGroups || [])
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [form, setForm] = useState({ username: '', display_name: '', email: '', password: '', confirm_password: '', role: 'operator', permissions: {}, group_id: '' })

  useEffect(() => {
    if (!open) return
    setShowPassword(false)
    setShowConfirmPassword(false)
    setPickerGroups(localGroups || [])
    setForm({ username: '', display_name: '', email: '', password: '', confirm_password: '', role: 'operator', permissions: {}, group_id: '' })

    Promise.all([
      initialRoleOptions?.length && initialRoleProfiles ? Promise.resolve({ data: [] }) : settingsApi.getRolePresets().catch(() => ({ data: [] })),
      groupsApi.list().catch(() => ({ data: localGroups || [] })),
    ]).then(([presetsRes, groupsRes]) => {
      const presets = presetsRes.data || []
      const nextRoleOptions = initialRoleOptions?.length ? initialRoleOptions : extractRoleOptions(presets)
      const nextRoleProfiles = initialRoleProfiles && Object.keys(initialRoleProfiles).length ? initialRoleProfiles : extractRoleProfiles(presets)
      const groupsData = Array.isArray(groupsRes.data) ? groupsRes.data : (localGroups || [])
      setRoleOptions(nextRoleOptions)
      setRoleProfiles(nextRoleProfiles)
      setPickerGroups(groupsData)
      setForm(current => ({ ...current, permissions: mergeWithRoleBaseline(current.role, current.permissions, nextRoleProfiles) }))
    })
  }, [open, initialRoleOptions, initialRoleProfiles, localGroups])

  const handleGeneratePassword = () => {
    const generated = generateStrongPassword()
    setForm(f => ({ ...f, password: generated, confirm_password: generated }))
    toast.success('Password generated')
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.username.trim()) { toast.error('Username is required'); return }
    if (!form.display_name.trim()) { toast.error('Display name is required'); return }
    if (!form.email.trim()) { toast.error('Email is required'); return }
    if (!form.group_id) { toast.error('Group is required'); return }
    if (!form.confirm_password) { toast.error('Please confirm the password'); return }
    if (form.password !== form.confirm_password) { toast.error('Passwords do not match'); return }
    if (!passwordPolicyOk(form.password)) {
      toast.error('Password does not meet minimum security requirements')
      return
    }

    setSaving(true)
    try {
      const payload = { ...form, permissions: mergeWithRoleBaseline(form.role, form.permissions, roleProfiles) }
      delete payload.confirm_password
      if (form.role === 'admin') payload.permissions = {}
      const res = await usersApi.create(payload)
      toast.success('User created')
      onCreated && onCreated({
        id: res.data?.id,
        username: form.username.trim(),
        display_name: form.display_name.trim(),
        email: form.email.trim(),
        auth_type: 'local',
      })
      onClose()
    } catch (err) {
      const errs = err.response?.data?.errors
      const msg = errs ? errs.map(x => `${x.path}: ${x.msg}`).join(' • ') : (err.response?.data?.error || 'Error')
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return open ? (
    <Modal title="New local user" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Username *</label>
            <input className="input" required value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Display name *</label>
            <input className="input" required value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Email *</label>
          <input className="input" type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Password *</label>
          <div className="flex items-center gap-2">
            <input className="input" type={showPassword ? 'text' : 'password'} required value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            <button type="button" className="btn-secondary" onClick={() => setShowPassword(v => !v)} title={showPassword ? 'Hide password' : 'Show password'} aria-label={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button type="button" className="btn-secondary whitespace-nowrap" onClick={handleGeneratePassword}>
              <Wand2 size={14} />
              Generate
            </button>
          </div>
          <PasswordRequirements password={form.password} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Confirm password *</label>
          <div className="flex items-center gap-2">
            <input className="input" type={showConfirmPassword ? 'text' : 'password'} required value={form.confirm_password} onChange={e => setForm(f => ({ ...f, confirm_password: e.target.value }))} />
            <button type="button" className="btn-secondary" onClick={() => setShowConfirmPassword(v => !v)} title={showConfirmPassword ? 'Hide password' : 'Show password'} aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}>
              {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        <LocalGroupPicker groups={pickerGroups} value={form.group_id} onChange={groupId => setForm(f => ({ ...f, group_id: groupId }))} required roleOptions={roleOptions} roleProfiles={roleProfiles} />
        <div>
          <label className="block text-sm font-medium mb-1">Role *</label>
          <select className="input" required value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value, permissions: rebaseRolePermissions(f.role, e.target.value, f.permissions, roleProfiles) }))}>
            {roleOptions.map(role => <option key={role} value={role}>{role}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">
            Permissions {form.role === 'admin' && <span className="text-gray-400 font-normal ml-1">(full access for admin)</span>}
          </label>
          <PermissionsEditor value={form.permissions} onChange={permissions => setForm(f => ({ ...f, permissions }))} disabled={form.role === 'admin'} lockedKeys={roleBaselineLockedKeys(form.role, roleProfiles)} />
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Crea'}</button>
        </div>
      </form>
    </Modal>
  ) : null
}

export function QuickCreateLocalGroupModal({ open, onClose, onCreated, initialRoleOptions, initialRoleProfiles }) {
  const [saving, setSaving] = useState(false)
  const [roleOptions, setRoleOptions] = useState(initialRoleOptions?.length ? initialRoleOptions : DEFAULT_ROLES)
  const [roleProfiles, setRoleProfiles] = useState(initialRoleProfiles || {})
  const [form, setForm] = useState({ name: '', description: '', role: 'viewer', permissions: {} })

  useEffect(() => {
    if (!open) return
    setForm({ name: '', description: '', role: 'viewer', permissions: {} })
    if (initialRoleOptions?.length && initialRoleProfiles && Object.keys(initialRoleProfiles).length) {
      setRoleOptions(initialRoleOptions)
      setRoleProfiles(initialRoleProfiles)
      return
    }
    settingsApi.getRolePresets()
      .then(r => {
        setRoleOptions(extractRoleOptions(r.data || []))
        setRoleProfiles(extractRoleProfiles(r.data || []))
      })
      .catch(() => {
        setRoleOptions(DEFAULT_ROLES)
        setRoleProfiles({})
      })
  }, [open, initialRoleOptions, initialRoleProfiles])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('Group name is required')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        role: form.role,
        permissions: mergeWithRoleBaseline(form.role, form.permissions, roleProfiles),
      }
      const res = await groupsApi.create(payload)
      toast.success('Group created')
      onCreated && onCreated({ id: res.data?.id, name: payload.name, ldap_mapping_count: 0, type: 'local_group' })
      onClose()
    } catch (err) {
      const errs = err.response?.data?.errors
      const msg = errs ? errs.map(x => `${x.path}: ${x.msg}`).join(' • ') : (err.response?.data?.error || 'Error')
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return open ? (
    <Modal title="New Group" onClose={onClose} size="sm">
      <form onSubmit={submit} className="space-y-4">
        <div><label className="block text-sm font-medium mb-1">Name *</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div><label className="block text-sm font-medium mb-1">Description</label><input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
        <div><label className="block text-sm font-medium mb-1">Role *</label>
          <select className="input" required value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value, permissions: rebaseRolePermissions(f.role, e.target.value, f.permissions, roleProfiles) }))}>
            {roleOptions.map(role => <option key={role} value={role}>{role}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Permissions</label>
          <PermissionsEditor value={form.permissions} onChange={permissions => setForm(f => ({ ...f, permissions }))} disabled={false} lockedKeys={roleBaselineLockedKeys(form.role, roleProfiles)} />
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  ) : null
}
