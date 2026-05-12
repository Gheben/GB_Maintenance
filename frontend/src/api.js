import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

// Attach JWT from localStorage on every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// On 401, clear auth and redirect to login
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (data) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  changePassword: (data) => api.post('/auth/change-password', data),
  sessions: () => api.get('/auth/sessions'),
  revokeSession: (id) => api.delete(`/auth/sessions/${id}`),
  revokeAll: () => api.post('/auth/sessions/revoke-all'),
  totpSetup: () => api.post('/auth/totp/setup'),
  totpVerify: (data) => api.post('/auth/totp/verify', data),
  totpDisable: () => api.post('/auth/totp/disable'),
  samlLogin: () => { window.location.href = '/api/auth/saml/login' },
}

// ─── Users ────────────────────────────────────────────────────────────────────
export const usersApi = {
  list: (params) => api.get('/users', { params }),
  get: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  roles: () => api.get('/users/roles'),
  permissions: () => api.get('/users/permissions'),
  sessions: (id) => api.get(`/users/${id}/sessions`),
  revokeSessions: (id) => api.post(`/users/${id}/revoke-sessions`),
}

// ─── Groups ───────────────────────────────────────────────────────────────────
export const groupsApi = {
  list: () => api.get('/groups'),
  get: (id) => api.get(`/groups/${id}`),
  create: (data) => api.post('/groups', data),
  update: (id, data) => api.put(`/groups/${id}`, data),
  delete: (id) => api.delete(`/groups/${id}`),
  addMember: (id, userId) => api.post(`/groups/${id}/members`, { user_ids: [userId] }),
  removeMember: (id, userId) => api.delete(`/groups/${id}/members/${userId}`),
  ldapMappings: () => api.get('/groups/ldap/mappings'),
  addLdapMapping: (data) => api.post('/groups/ldap/mappings', data),
  deleteLdapMapping: (id) => api.delete(`/groups/ldap/mappings/${id}`),
}

// ─── Assets ───────────────────────────────────────────────────────────────────
export const assetsApi = {
  list: (params) => api.get('/assets', { params }),
  get: (id) => api.get(`/assets/${id}`),
  create: (data) => api.post('/assets', data),
  update: (id, data) => api.put(`/assets/${id}`, data),
  delete: (id) => api.delete(`/assets/${id}`),
  history: (id) => api.get(`/assets/${id}/history`),
  probes: (id, params) => api.get(`/assets/${id}/probes`, { params }),
  probeNow: (id) => api.post(`/assets/${id}/probe`),
  maintenance: (id) => api.get(`/assets/${id}/maintenance`),
  patchStatus: (id, status) => api.patch(`/assets/${id}/status`, { status }),
  addDependency: (id, dep_id) => api.post(`/assets/${id}/dependencies`, { depends_on_id: dep_id }),
  removeDependency: (id, dep_id) => api.delete(`/assets/${id}/dependencies/${dep_id}`),
}

// ─── Services ─────────────────────────────────────────────────────────────────
export const servicesApi = {
  list: (params) => api.get('/services', { params }),
  get: (id) => api.get(`/services/${id}`),
  create: (data) => api.post('/services', data),
  update: (id, data) => api.put(`/services/${id}`, data),
  delete: (id) => api.delete(`/services/${id}`),
  uptime: (id, params) => api.get(`/services/${id}/uptime`, { params }),
  addAsset: (id, assetId) => api.post(`/services/${id}/assets`, { asset_id: assetId }),
  removeAsset: (id, assetId) => api.delete(`/services/${id}/assets/${assetId}`),
  subscribe: (id, data) => api.post(`/services/${id}/subscribe`, data),
  unsubscribe: (id) => api.delete(`/services/${id}/subscribe`),
  removeSubscriber: (id, subId) => api.delete(`/services/${id}/subscribers/${subId}`),
}

// ─── Maintenance ──────────────────────────────────────────────────────────────
export const maintenanceApi = {
  list: (params) => api.get('/maintenance', { params }),
  calendar: (params) => api.get('/maintenance/calendar', { params }),
  get: (id) => api.get(`/maintenance/${id}`),
  create: (data) => api.post('/maintenance', data),
  update: (id, data) => api.put(`/maintenance/${id}`, data),
  delete: (id) => api.delete(`/maintenance/${id}`),
  approve: (id) => api.post(`/maintenance/${id}/approve`),
  reject: (id, reason) => api.post(`/maintenance/${id}/reject`, { reason }),
  start: (id) => api.post(`/maintenance/${id}/start`),
  complete: (id, notes) => api.post(`/maintenance/${id}/complete`, { notes }),
  cancel: (id, reason) => api.post(`/maintenance/${id}/cancel`, { reason }),
}

// ─── Incidents ────────────────────────────────────────────────────────────────
export const incidentsApi = {
  list: (params) => api.get('/incidents', { params }),
  active: () => api.get('/incidents/active'),
  get: (id) => api.get(`/incidents/${id}`),
  create: (data) => api.post('/incidents', data),
  update: (id, data) => api.put(`/incidents/${id}`, data),
  delete: (id) => api.delete(`/incidents/${id}`),
  addUpdate: (id, data) => api.post(`/incidents/${id}/updates`, data),
}

// ─── Notifications ────────────────────────────────────────────────────────────
export const notificationsApi = {
  list: (params) => api.get('/notifications', { params }),
  markRead: (ids) => api.post('/notifications/read', { ids }),
  markAllRead: () => api.post('/notifications/read', {}),
  log: (params) => api.get('/notifications/log', { params }),
  templates: () => api.get('/notifications/templates'),
  updateTemplate: (id, data) => api.put(`/notifications/templates/${id}`, data),
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export const settingsApi = {
  getSmtp: () => api.get('/settings/smtp'),
  saveSmtp: (data) => api.put('/settings/smtp', data),
  testSmtp: (data) => api.post('/settings/smtp/test', data),
  getLdap: () => api.get('/settings/ldap'),
  saveLdap: (data) => api.put('/settings/ldap', data),
  testLdap: (data) => api.post('/settings/ldap/test', data),
  searchLdapGroups: (q) => api.get('/settings/ldap/groups', { params: { q } }),
  getSaml: () => api.get('/settings/saml'),
  saveSaml: (data) => api.put('/settings/saml', data),
  getWebhooks: () => api.get('/settings/webhooks'),
  saveWebhooks: (data) => api.put('/settings/webhooks', data),
  getGeneral: () => api.get('/settings/general'),
  saveGeneral: (data) => api.put('/settings/general', data),
}

// ─── Status ───────────────────────────────────────────────────────────────────
export const statusApi = {
  overview: () => api.get('/status'),
  service: (slug) => api.get(`/status/services/${slug}`),
}

// ─── Reports ──────────────────────────────────────────────────────────────────
export const reportsApi = {
  maintenance: (params) => api.get('/reports/maintenance', { params }),
  uptime: (params) => api.get('/reports/uptime', { params }),
  assets: () => api.get('/reports/assets'),
  dashboard: () => api.get('/reports/dashboard'),
}

// ─── API Keys ─────────────────────────────────────────────────────────────────
export const apikeysApi = {
  list: () => api.get('/apikeys'),
  create: (data) => api.post('/apikeys', data),
  update: (id, data) => api.patch(`/apikeys/${id}`, data),
  delete: (id) => api.delete(`/apikeys/${id}`),
}

// ─── Audit ────────────────────────────────────────────────────────────────────
export const auditApi = {
  list: (params) => api.get('/audit', { params }),
}

// ─── Templates ────────────────────────────────────────────────────────────────
export const templatesApi = {
  list: () => api.get('/templates/maintenance'),
  get: (id) => api.get(`/templates/maintenance/${id}`),
  create: (data) => api.post('/templates/maintenance', data),
  update: (id, data) => api.put(`/templates/maintenance/${id}`, data),
  delete: (id) => api.delete(`/templates/maintenance/${id}`),
}

// ─── Blackout ─────────────────────────────────────────────────────────────────
export const blackoutApi = {
  list: () => api.get('/blackout'),
  get: (id) => api.get(`/blackout/${id}`),
  check: (start, end) => api.get('/blackout/check', { params: { start, end } }),
  create: (data) => api.post('/blackout', data),
  update: (id, data) => api.put(`/blackout/${id}`, data),
  delete: (id) => api.delete(`/blackout/${id}`),
}
