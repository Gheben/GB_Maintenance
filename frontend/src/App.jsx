import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { NotificationsProvider } from './contexts/NotificationsContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ToastContainer } from './components/Toast'
import { settingsApi } from './api'

import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Assets from './pages/Assets'
import AssetDetail from './pages/AssetDetail'
import Services from './pages/Services'
import Maintenance from './pages/Maintenance'
import MaintenanceDetail from './pages/MaintenanceDetail'
import Incidents from './pages/Incidents'
import IncidentDetail from './pages/IncidentDetail'
import StatusPage from './pages/StatusPage'
import Notifications from './pages/Notifications'
import Users from './pages/Users'
import Settings from './pages/Settings'
import Reports from './pages/Reports'
import ApiKeys from './pages/ApiKeys'
import AuditLog from './pages/AuditLog'
import Templates from './pages/Templates'
import BlackoutPeriods from './pages/BlackoutPeriods'
import ServiceDetail from './pages/ServiceDetail'
import Calendar from './pages/Calendar'
import LocalGroups from './pages/LocalGroups'
import Licenses from './pages/Licenses'
import LicenseApproval from './pages/LicenseApproval'
import MaintenanceTypes from './pages/MaintenanceTypes'
import AssetCategories from './pages/AssetCategories'

const P = ({ children, perm }) => <ProtectedRoute permission={perm}>{children}</ProtectedRoute>

export default function App() {
  useEffect(() => {
    const applyBrandingFromPayload = (b) => {
      if (!b || typeof b !== 'object') return
      const appName = String(b.app_name || 'GB Maintenance').trim()
      const appImage = String(b.app_brand_image_url || '').trim()

      if (appName) document.title = appName
      if (appImage) {
        // Add timestamp to force browser cache busting
        const ts = Date.now()
        const imageWithTs = `${appImage}?v=${ts}`
        
        // Update all favicon links
        document.querySelectorAll('link[rel="icon"]').forEach(link => {
          link.href = imageWithTs
        })
        
        // Update apple-touch-icon
        let appleTouchLink = document.head.querySelector('link[rel="apple-touch-icon"]')
        if (!appleTouchLink) {
          appleTouchLink = document.createElement('link')
          appleTouchLink.setAttribute('rel', 'apple-touch-icon')
          document.head.appendChild(appleTouchLink)
        }
        appleTouchLink.href = imageWithTs
      }
    }

    const applyBranding = async () => {
      try {
        const r = await settingsApi.publicBranding()
        applyBrandingFromPayload(r.data || {})
      } catch {
        // Keep static defaults if branding cannot be loaded.
      }
    }

    const onBrandingUpdate = (ev) => {
      applyBrandingFromPayload(ev?.detail || {})
    }

    applyBranding()
    window.addEventListener('app-branding-updated', onBrandingUpdate)
    return () => window.removeEventListener('app-branding-updated', onBrandingUpdate)
  }, [])

  return (
    <ThemeProvider>
      <AuthProvider>
        <NotificationsProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/status" element={<StatusPage />} />
              <Route path="/licenses/approval" element={<LicenseApproval />} />
              <Route path="/" element={<P><Dashboard /></P>} />
              <Route path="/assets" element={<P perm="assets"><Assets /></P>} />
              <Route path="/assets/categories" element={<P perm="assets"><AssetCategories /></P>} />
              <Route path="/assets/:id" element={<P perm="assets"><AssetDetail /></P>} />
              <Route path="/services" element={<P perm="services"><Services /></P>} />
              <Route path="/services/:id" element={<P perm="services"><ServiceDetail /></P>} />
              <Route path="/maintenance" element={<P perm="maintenance"><Maintenance /></P>} />
              <Route path="/maintenance/types" element={<P perm="maintenance"><MaintenanceTypes /></P>} />
              <Route path="/calendar" element={<P perm="maintenance"><Calendar /></P>} />
              <Route path="/maintenance/:id" element={<P perm="maintenance"><MaintenanceDetail /></P>} />
              <Route path="/incidents" element={<P perm="incidents"><Incidents /></P>} />
              <Route path="/incidents/:id" element={<P perm="incidents"><IncidentDetail /></P>} />
              <Route path="/notifications" element={<P perm="notifications"><Notifications /></P>} />
              <Route path="/users" element={<P perm="users"><Users /></P>} />
              <Route path="/licenses" element={<P perm="maintenance"><Licenses /></P>} />
              <Route path="/groups" element={<Navigate to="/users?tab=groups" replace />} />
              <Route path="/settings" element={<P perm="settings"><Settings /></P>} />
              <Route path="/reports" element={<P perm="reports"><Reports /></P>} />
              <Route path="/apikeys" element={<P perm="apikeys"><ApiKeys /></P>} />
              <Route path="/audit" element={<P perm="audit"><AuditLog /></P>} />
              <Route path="/templates" element={<P perm="maintenance"><Templates /></P>} />
              <Route path="/blackout" element={<P perm="maintenance"><BlackoutPeriods /></P>} />
              <Route path="/groups" element={<P perm="users"><LocalGroups /></P>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            <ToastContainer />
          </BrowserRouter>
        </NotificationsProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
