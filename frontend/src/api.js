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
  probeConfigs: (id) => api.get(`/assets/${id}/probe-configs`),
  createProbeConfig: (id, data) => api.post(`/assets/${id}/probe-configs`, data),
  updateProbeConfig: (id, probeId, data) => api.put(`/assets/${id}/probe-configs/${probeId}`, data),
  deleteProbeConfig: (id, probeId) => api.delete(`/assets/${id}/probe-configs/${probeId}`),
  probeNow: (id) => api.post(`/assets/${id}/probe`),
  probeNowById: (id, probeId) => api.post(`/assets/${id}/probe-configs/${probeId}/run`),
  users: (id) => api.get(`/assets/${id}/users`),
  maintenance: (id, params) => api.get(`/assets/${id}/maintenance`, { params }),
  licenses: (id) => api.get(`/assets/${id}/licenses`),
  updateLicenses: (id, licenseIds) => api.put(`/assets/${id}/licenses`, { license_ids: licenseIds }),
  patchStatus: (id, status) => api.patch(`/assets/${id}/status`, { status }),
  addDependency: (id, dep_id) => api.post(`/assets/${id}/dependencies`, { depends_on_id: dep_id }),
  removeDependency: (id, dep_id) => api.delete(`/assets/${id}/dependencies/${dep_id}`),
  getGraph: (id, params) => api.get(`/assets/${id}/graph`, { params }),
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
  addDependency: (id, depId) => api.post(`/services/${id}/dependencies`, { depends_on_id: depId }),
  removeDependency: (id, depId) => api.delete(`/services/${id}/dependencies/${depId}`),
  maintenance: (id, params) => api.get(`/services/${id}/maintenance`, { params }),
  users: (id) => api.get(`/services/${id}/users`),
  licenses: (id) => api.get(`/services/${id}/licenses`),
  updateLicenses: (id, licenseIds) => api.put(`/services/${id}/licenses`, { license_ids: licenseIds }),
  // Probe endpoints
  probeConfigs: (id) => api.get(`/services/${id}/probe-configs`),
  createProbeConfig: (id, data) => api.post(`/services/${id}/probe-configs`, data),
  updateProbeConfig: (id, probeId, data) => api.put(`/services/${id}/probe-configs/${probeId}`, data),
  deleteProbeConfig: (id, probeId) => api.delete(`/services/${id}/probe-configs/${probeId}`),
  probeNow: (id) => api.post(`/services/${id}/probe`),
  probeNowById: (id, probeId) => api.post(`/services/${id}/probe-configs/${probeId}/run`),
  probes: (id, params) => api.get(`/services/${id}/probes`, { params }),
  getGraph: (id, params) => api.get(`/services/${id}/graph`, { params }),
}

// ─── Maintenance ──────────────────────────────────────────────────────────────
export const maintenanceApi = {
  list: (params) => api.get('/maintenance', { params }),
  calendar: (params) => api.get('/maintenance/calendar', { params }),
  get: (id) => api.get(`/maintenance/${id}`),
  approvalStatus: (id) => api.get(`/maintenance/${id}/approval-status`),
  create: (data) => api.post('/maintenance', data),
  update: (id, data) => api.put(`/maintenance/${id}`, data),
  delete: (id, cancellationReason) => api.delete(`/maintenance/${id}`, {
    data: cancellationReason ? { cancellation_reason: cancellationReason } : undefined,
  }),
  approve: (id) => api.post(`/maintenance/${id}/approve`),
  reject: (id, reason) => api.post(`/maintenance/${id}/reject`, { reason }),
  ownerRespond: (id, approvalId, data) => api.post(`/maintenance/${id}/owner-approvals/${approvalId}/respond`, data),
  creatorDecision: (id, approvalId, data) => api.post(`/maintenance/${id}/owner-approvals/${approvalId}/creator-decision`, data),
  start: (id) => api.post(`/maintenance/${id}/start`),
  complete: (id, notes) => api.post(`/maintenance/${id}/complete`, { notes }),
  reopen: (id, reason) => api.post(`/maintenance/${id}/reopen`, { reason }),
  cancel: (id, reason) => api.post(`/maintenance/${id}/cancel`, { reason }),
  users: (id) => api.get(`/maintenance/${id}/users`),
  publicOwnerApproval: (token) => api.get('/maintenance/public/owner-approval', { params: { token } }),
  publicOwnerApprovalRespond: (data) => api.post('/maintenance/public/owner-approval/respond', data),
}

// ─── Maintenance Types ────────────────────────────────────────────────────────
export const maintenanceTypesApi = {
  list: () => api.get('/maintenance-types'),
  create: (data) => api.post('/maintenance-types', data),
  update: (id, data) => api.put(`/maintenance-types/${id}`, data),
  delete: (id) => api.delete(`/maintenance-types/${id}`),
}

export const assetCategoriesApi = {
  list: () => api.get('/asset-categories'),
  create: (data) => api.post('/asset-categories', data),
  update: (id, data) => api.put(`/asset-categories/${id}`, data),
  delete: (id) => api.delete(`/asset-categories/${id}`),
}

export const incidentSeveritiesApi = {
  list: () => api.get('/incident-severities'),
  create: (data) => api.post('/incident-severities', data),
  update: (id, data) => api.put(`/incident-severities/${id}`, data),
  delete: (id) => api.delete(`/incident-severities/${id}`),
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
  users: (id) => api.get(`/incidents/${id}/users`),
}

// ─── Notifications ────────────────────────────────────────────────────────────
export const notificationsApi = {
  list: (params) => api.get('/notifications', { params }),
  markRead: (ids) => api.post('/notifications/read', { ids }),
  markAllRead: () => api.post('/notifications/read', {}),
  deleteAll: () => api.delete('/notifications'),
  log: (params) => api.get('/notifications/log', { params }),
  templates: () => api.get('/notifications/templates'),
  updateTemplate: (id, data) => api.put(`/notifications/templates/${id}`, data),
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export const settingsApi = {
  publicBranding: () => api.get('/settings/public-branding'),
  getSmtp: () => api.get('/settings/smtp'),
  saveSmtp: (data) => api.put('/settings/smtp', data),
  testSmtp: (data) => api.post('/settings/smtp/test', data),
  getLdap: () => api.get('/settings/ldap'),
  saveLdap: (data) => api.put('/settings/ldap', data),
  testLdap: (data) => api.post('/settings/ldap/test', data),
  getLdapEnabled: () => api.get('/settings/ldap/enabled'),
  searchLdapGroups: (q) => api.get('/settings/ldap/groups', { params: { q } }),
  searchLdapUsers: (q) => api.get('/settings/ldap/users', { params: { q } }),
  getSaml: () => api.get('/settings/saml'),
  saveSaml: (data) => api.put('/settings/saml', data),
  getWebhooks: () => api.get('/settings/webhooks'),
  saveWebhooks: (data) => api.put('/settings/webhooks', data),
  getGeneral: () => api.get('/settings/general'),
  saveGeneral: (data) => api.put('/settings/general', data),
  getNtp: () => api.get('/settings/ntp'),
  saveNtp: (data) => api.put('/settings/ntp', data),
  queryNtp: (server) => api.post('/settings/ntp/query', { server }),
  getRolePresets: () => api.get('/settings/role-presets'),
  saveRolePresets: (data) => api.put('/settings/role-presets', data),
  getDemoStatus: () => api.get('/settings/demo/status'),
  createDemoData: () => api.post('/settings/demo/create'),
  clearDemoData: () => api.post('/settings/demo/clear'),
  dataTransferOptions: () => api.get('/settings/data-transfer/options'),
  exportData: (groups, includeSensitive = false) => api.get('/settings/data-transfer/export', {
    params: { groups: groups.length ? groups.join(',') : 'all', include_sensitive: includeSensitive },
  }),
  importData: (data, groups, dryRun = false) => api.post('/settings/data-transfer/import', { data, groups, dry_run: dryRun }),
  deleteData: (groups, all = false) => api.post('/settings/data-transfer/delete', {
    groups,
    all,
    confirmation: 'DELETE_SELECTED_DATA',
  }),
}

// ─── Status ───────────────────────────────────────────────────────────────────
export const statusApi = {
  overview: () => api.get('/status'),
  service: (slug) => api.get(`/status/services/${slug}`),
  subscribeMaintenance: (id) => api.post(`/status/maintenance/${id}/subscribe`),
  unsubscribeMaintenance: (id) => api.delete(`/status/maintenance/${id}/subscribe`),
}

// ─── Reports ──────────────────────────────────────────────────────────────────
export const reportsApi = {
  maintenance: (params) => api.get('/reports/maintenance', { params }),
  maintenanceExportCsv: (params) => api.get('/reports/maintenance', { params: { ...(params || {}), format: 'csv' }, responseType: 'blob' }),
  maintenanceExportXlsx: (params) => api.get('/reports/maintenance', { params: { ...(params || {}), format: 'xlsx' }, responseType: 'blob' }),
  maintenanceExportPdf: (params) => api.get('/reports/maintenance', { params: { ...(params || {}), format: 'pdf' }, responseType: 'blob' }),
  uptime: (params) => api.get('/reports/uptime', { params }),
  assets: (params) => api.get('/reports/assets', { params }),
  assetsExport: (format) => api.get('/reports/assets', { params: { format }, responseType: 'blob' }),
  licenses: (params) => api.get('/reports/licenses', { params }),
  licensesExport: (format) => api.get('/reports/licenses', { params: { format }, responseType: 'blob' }),
  dashboard: (params) => api.get('/reports/dashboard', { params }),
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
  purge: (days) => api.delete('/audit/purge', { params: { days } }),
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

// ─── Licenses ────────────────────────────────────────────────────────────────
export const licensesApi = {
  list: (params) => api.get('/licenses', { params }),
  report: () => api.get('/licenses/report', { responseType: 'blob' }),
  history: (id) => api.get(`/licenses/${id}/history`),
  renew: (id, data) => api.post(`/licenses/${id}/renew`, data),
  get: (id) => api.get(`/licenses/${id}`),
  create: (data) => api.post('/licenses', data),
  update: (id, data) => api.put(`/licenses/${id}`, data),
  delete: (id) => api.delete(`/licenses/${id}`),
  approve: (id) => api.post(`/licenses/${id}/approve`),
  reject: (id, reason) => api.post(`/licenses/${id}/reject`, { reason }),
  requestApproval: (id, data) => api.post(`/licenses/${id}/request-approval`, data || {}),
  approvalInfo: (token) => api.get(`/licenses/approval/${encodeURIComponent(token)}`),
  approvalApprove: (token) => api.post(`/licenses/approval/${encodeURIComponent(token)}/approve`),
  approvalReject: (token, reason) => api.post(`/licenses/approval/${encodeURIComponent(token)}/reject`, { reason }),
  approvalStatusInfo: (token) => api.get(`/licenses/status/${encodeURIComponent(token)}`),
  approvalRequests: (token) => api.get(`/licenses/approval/${encodeURIComponent(token)}/requests`),
  approvalInfoForRequest: (token, requestId) => api.get(`/licenses/approval/${encodeURIComponent(token)}/request/${requestId}`),
  approvalApproveRequest: (token, requestId) => api.post(`/licenses/approval/${encodeURIComponent(token)}/request/${requestId}/approve`),
  approvalRejectRequest: (token, requestId, reason) => api.post(`/licenses/approval/${encodeURIComponent(token)}/request/${requestId}/reject`, { reason }),
}

export const suppliersApi = {
  list: (params) => api.get('/suppliers', { params }),
  get: (id) => api.get(`/suppliers/${id}`),
  create: (data) => api.post('/suppliers', data),
  update: (id, data) => api.put(`/suppliers/${id}`, data),
  delete: (id) => api.delete(`/suppliers/${id}`),
}

export const uploadsApi = {
  uploadLicenseDocument: (file) => {
    const data = new FormData()
    data.append('file', file)
    return api.post('/uploads/license-document', data, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  uploadLicenseTemplateLogo: (file) => {
    const data = new FormData()
    data.append('file', file)
    return api.post('/uploads/license-template-logo', data, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  uploadAppBrandImage: (file) => {
    const data = new FormData()
    data.append('file', file)
    return api.post('/uploads/app-brand-image', data, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  uploadSupplierDocument: (file) => {
    const data = new FormData()
    data.append('file', file)
    return api.post('/uploads/supplier-document', data, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
}
