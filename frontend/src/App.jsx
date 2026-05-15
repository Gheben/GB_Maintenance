import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, Suspense, lazy } from 'react'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { NotificationsProvider } from './contexts/NotificationsContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ToastContainer } from './components/Toast'
import { settingsApi } from './api'

let routeChunksPreloaded = false

function preloadRouteChunks() {
  if (routeChunksPreloaded) return
  routeChunksPreloaded = true
  Promise.allSettled([
    import('./pages/Dashboard'),
    import('./pages/Assets'),
    import('./pages/AssetDetail'),
    import('./pages/Services'),
    import('./pages/ServiceDetail'),
    import('./pages/Maintenance'),
    import('./pages/MaintenanceDetail'),
    import('./pages/Incidents'),
    import('./pages/IncidentDetail'),
    import('./pages/Notifications'),
    import('./pages/Users'),
    import('./pages/Licenses'),
    import('./pages/Reports'),
    import('./pages/Settings'),
  ]).catch(() => {})
}

const Login = lazy(() => import('./pages/Login'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Assets = lazy(() => import('./pages/Assets'))
const AssetDetail = lazy(() => import('./pages/AssetDetail'))
const Services = lazy(() => import('./pages/Services'))
const Maintenance = lazy(() => import('./pages/Maintenance'))
const MaintenanceDetail = lazy(() => import('./pages/MaintenanceDetail'))
const Incidents = lazy(() => import('./pages/Incidents'))
const IncidentDetail = lazy(() => import('./pages/IncidentDetail'))
const StatusPage = lazy(() => import('./pages/StatusPage'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Users = lazy(() => import('./pages/Users'))
const Settings = lazy(() => import('./pages/Settings'))
const Reports = lazy(() => import('./pages/Reports'))
const ApiKeys = lazy(() => import('./pages/ApiKeys'))
const AuditLog = lazy(() => import('./pages/AuditLog'))
const Templates = lazy(() => import('./pages/Templates'))
const BlackoutPeriods = lazy(() => import('./pages/BlackoutPeriods'))
const ServiceDetail = lazy(() => import('./pages/ServiceDetail'))
const Calendar = lazy(() => import('./pages/Calendar'))
const LocalGroups = lazy(() => import('./pages/LocalGroups'))
const Licenses = lazy(() => import('./pages/Licenses'))
const LicenseApproval = lazy(() => import('./pages/LicenseApproval'))
const MaintenanceTypes = lazy(() => import('./pages/MaintenanceTypes'))
const AssetCategories = lazy(() => import('./pages/AssetCategories'))
const IncidentSeverities = lazy(() => import('./pages/IncidentSeverities'))

const P = ({ children, perm }) => <ProtectedRoute permission={perm}>{children}</ProtectedRoute>

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent">
      <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  useEffect(() => {
    const getCachedBranding = () => {
      try {
        const raw = localStorage.getItem('public_branding_cache')
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : null
      } catch {
        return null
      }
    }

    const setCachedBranding = (payload) => {
      try {
        localStorage.setItem('public_branding_cache', JSON.stringify(payload || {}))
      } catch {
        // Ignore quota/storage errors.
      }
    }

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
        const payload = r.data || {}
        applyBrandingFromPayload(payload)
        setCachedBranding(payload)
      } catch {
        // Keep static defaults if branding cannot be loaded.
      }
    }

    const onBrandingUpdate = (ev) => {
      applyBrandingFromPayload(ev?.detail || {})
    }

    applyBrandingFromPayload(getCachedBranding())
    applyBranding()
    window.addEventListener('app-branding-updated', onBrandingUpdate)
    return () => window.removeEventListener('app-branding-updated', onBrandingUpdate)
  }, [])

  useEffect(() => {
    if (!localStorage.getItem('token')) return

    let cancelled = false
    const preload = () => {
      if (cancelled) return
      preloadRouteChunks()
    }

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(preload, { timeout: 1200 })
      return () => {
        cancelled = true
        window.cancelIdleCallback(id)
      }
    }

    const timer = setTimeout(preload, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  return (
    <ThemeProvider>
      <AuthProvider>
        <NotificationsProvider>
          <BrowserRouter>
            <Suspense fallback={<PageFallback />}>
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
                <Route path="/incidents/severities" element={<P perm="incidents"><IncidentSeverities /></P>} />
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
            </Suspense>
            <ToastContainer />
          </BrowserRouter>
        </NotificationsProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
