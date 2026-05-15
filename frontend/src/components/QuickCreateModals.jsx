import { useEffect, useMemo, useState } from 'react'
import { Modal } from './Modal'
import { toast } from './Toast'
import { usersApi, groupsApi, settingsApi } from '../api'

const DEFAULT_ROLES = ['admin', 'change_manager', 'operator', 'viewer', 'subscriber']

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

function roleBaseline(role, roleProfiles) {
  const baseline = roleProfiles?.[role] || {}
  const out = {}
  for (const key of Object.keys(baseline)) {
    if (baseline[key]) out[key] = true
  }
  return out
}

export function QuickCreateUserModal({ open, onClose, onCreated, localGroups = [] }) {
  const [saving, setSaving] = useState(false)
  const [roleOptions, setRoleOptions] = useState(DEFAULT_ROLES)
  const [form, setForm] = useState({
    username: '',
    display_name: '',
    email: '',
    password: '',
    role: 'operator',
    group_id: '',
  })

  const availableGroups = useMemo(
    () => (localGroups || []).filter(g => !g.ldap_mapping_count || g.ldap_mapping_count === 0),
    [localGroups]
  )

  useEffect(() => {
    if (!open) return
    setForm({ username: '', display_name: '', email: '', password: '', role: 'operator', group_id: '' })
    settingsApi.getRolePresets()
      .then(r => setRoleOptions(extractRoleOptions(r.data || [])))
      .catch(() => setRoleOptions(DEFAULT_ROLES))
  }, [open])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.username.trim() || !form.password || !form.role) {
      toast.error('Username, password and role are required')
      return
    }
    if (availableGroups.length > 0 && !form.group_id) {
      toast.error('Local group is required')
      return
    }
    setSaving(true)
    try {
      const res = await usersApi.create({
        username: form.username.trim(),
        display_name: form.display_name.trim() || form.username.trim(),
        email: form.email.trim() || null,
        password: form.password,
        role: form.role,
        permissions: {},
        group_id: form.group_id || undefined,
      })
      toast.success('Local user created')
      onCreated && onCreated({
        id: res.data?.id,
        username: form.username.trim(),
        display_name: form.display_name.trim() || form.username.trim(),
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
    <Modal title="New Local User" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Username *</label>
          <input className="input" required value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Display name</label>
          <input className="input" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Email</label>
          <input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Password *</label>
          <input className="input" type="password" required value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          <p className="text-xs text-gray-500 mt-1">At least 8 chars, 1 uppercase, 1 number, 1 special char.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Role *</label>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {roleOptions.map(role => <option key={role} value={role}>{role}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Local group {availableGroups.length > 0 ? '*' : ''}</label>
            <select className="input" value={form.group_id} onChange={e => setForm(f => ({ ...f, group_id: e.target.value }))}>
              <option value="">{availableGroups.length > 0 ? 'Select group' : 'No local groups available'}</option>
              {availableGroups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  ) : null
}

export function QuickCreateLocalGroupModal({ open, onClose, onCreated }) {
  const [saving, setSaving] = useState(false)
  const [roleOptions, setRoleOptions] = useState(DEFAULT_ROLES)
  const [roleProfiles, setRoleProfiles] = useState({})
  const [form, setForm] = useState({ name: '', description: '', role: 'viewer' })

  useEffect(() => {
    if (!open) return
    setForm({ name: '', description: '', role: 'viewer' })
    settingsApi.getRolePresets()
      .then(r => {
        setRoleOptions(extractRoleOptions(r.data || []))
        setRoleProfiles(extractRoleProfiles(r.data || []))
      })
      .catch(() => {
        setRoleOptions(DEFAULT_ROLES)
        setRoleProfiles({})
      })
  }, [open])

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
        permissions: roleBaseline(form.role, roleProfiles),
      }
      const res = await groupsApi.create(payload)
      toast.success('Local group created')
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
    <Modal title="New Local Group" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Name *</label>
          <input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Role *</label>
          <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            {roleOptions.map(role => <option key={role} value={role}>{role}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  ) : null
}
