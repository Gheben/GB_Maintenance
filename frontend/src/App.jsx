import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState, Suspense, lazy } from 'react'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { NotificationsProvider } from './contexts/NotificationsContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ToastContainer } from './components/Toast'
import { settingsApi } from './api'

import Dashboard from './pages/Dashboard'
import Assets from './pages/Assets'
import Services from './pages/Services'
import Maintenance from './pages/Maintenance'
import Incidents from './pages/Incidents'
import Calendar from './pages/Calendar'
import Notifications from './pages/Notifications'
import Users from './pages/Users'
import Licenses from './pages/Licenses'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import BlackoutPeriods from './pages/BlackoutPeriods'
import AuditLog from './pages/AuditLog'
import ApiKeys from './pages/ApiKeys'

const Login = lazy(() => import('./pages/Login'))
const AssetDetail = lazy(() => import('./pages/AssetDetail'))
const MaintenanceDetail = lazy(() => import('./pages/MaintenanceDetail'))
const IncidentDetail = lazy(() => import('./pages/IncidentDetail'))
const StatusPage = lazy(() => import('./pages/StatusPage'))
const Templates = lazy(() => import('./pages/Templates'))
const ServiceDetail = lazy(() => import('./pages/ServiceDetail'))
const LocalGroups = lazy(() => import('./pages/LocalGroups'))
const LicenseApproval = lazy(() => import('./pages/LicenseApproval'))
const LicenseApprovalStatus = lazy(() => import('./pages/LicenseApprovalStatus'))
const MaintenanceOwnerApproval = lazy(() => import('./pages/MaintenanceOwnerApproval'))
const MaintenanceTypes = lazy(() => import('./pages/MaintenanceTypes'))
const AssetCategories = lazy(() => import('./pages/AssetCategories'))
const IncidentSeverities = lazy(() => import('./pages/IncidentSeverities'))

const P = ({ children, perm, roles }) => <ProtectedRoute permission={perm} roles={roles}>{children}</ProtectedRoute>

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent">
      <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export default function App() {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [showInstallHint, setShowInstallHint] = useState(false)

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
    if (isStandalone) return undefined

    const isAppleMobile = /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    const dismissed = localStorage.getItem('gb_install_hint_dismissed') === '1'
    const handleBeforeInstall = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
      if (!dismissed) setShowInstallHint(true)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    if (isAppleMobile && !dismissed) setShowInstallHint(true)
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
  }, [])

  const dismissInstallHint = () => {
    localStorage.setItem('gb_install_hint_dismissed', '1')
    setShowInstallHint(false)
  }

  const installApp = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
    setShowInstallHint(false)
  }

  useEffect(() => {
    let dynamicManifestUrl = null

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

    const applyPwaBranding = async ({ appName, appImage }) => {
      if (!appName) return

      let appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]')
      if (!appleTitleMeta) {
        appleTitleMeta = document.createElement('meta')
        appleTitleMeta.setAttribute('name', 'apple-mobile-web-app-title')
        document.head.appendChild(appleTitleMeta)
      }
      appleTitleMeta.setAttribute('content', appName)

      const manifestLink = document.querySelector('link[rel="manifest"]')
      if (!manifestLink) return

      const savedOriginalHref = manifestLink.getAttribute('data-original-href')
      const currentHref = manifestLink.getAttribute('href') || '/manifest.json'
      const originalHref = savedOriginalHref || currentHref
      if (!savedOriginalHref) manifestLink.setAttribute('data-original-href', originalHref)

      try {
        const response = await fetch(originalHref, { cache: 'no-store' })
        if (!response.ok) return
        const manifest = await response.json()
        const imageWithTs = appImage
          ? `${appImage}${appImage.includes('?') ? '&' : '?'}v=${Date.now()}`
          : ''

        const updatedManifest = {
          ...manifest,
          name: appName,
          short_name: appName,
          ...(imageWithTs
            ? {
              icons: [
                {
                  src: imageWithTs,
                  sizes: '192x192',
                  type: 'image/png',
                  purpose: 'any maskable',
                },
                {
                  src: imageWithTs,
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'any maskable',
                },
              ],
            }
            : {}),
        }

        const blob = new Blob([JSON.stringify(updatedManifest)], { type: 'application/manifest+json' })
        const nextManifestUrl = URL.createObjectURL(blob)
        manifestLink.setAttribute('href', nextManifestUrl)

        if (dynamicManifestUrl) URL.revokeObjectURL(dynamicManifestUrl)
        dynamicManifestUrl = nextManifestUrl
      } catch {
        // Keep the static manifest if dynamic generation fails.
      }
    }

    const applyBrandingFromPayload = (b) => {
      if (!b || typeof b !== 'object') return
      const appName = String(b.app_name || 'GB Maintenance').trim()
      const appImage = String(b.app_brand_image_url || '').trim()

      if (appName) {
        document.title = appName
        applyPwaBranding({ appName, appImage })
      }
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
    return () => {
      window.removeEventListener('app-branding-updated', onBrandingUpdate)
      if (dynamicManifestUrl) URL.revokeObjectURL(dynamicManifestUrl)
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
                <Route path="/licenses/approval-status" element={<LicenseApprovalStatus />} />
                <Route path="/maintenance/approval" element={<MaintenanceOwnerApproval />} />
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
                <Route path="/audit" element={<P perm="audit" roles={['superadmin']}><AuditLog /></P>} />
                <Route path="/templates" element={<P perm="maintenance"><Templates /></P>} />
                <Route path="/blackout" element={<P perm="maintenance"><BlackoutPeriods /></P>} />
                <Route path="/groups" element={<P perm="users"><LocalGroups /></P>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
            <ToastContainer />
            {showInstallHint && (
              <div className="fixed bottom-4 right-4 z-[80] max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                <button type="button" className="absolute right-2 top-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" onClick={dismissInstallHint} aria-label="Dismiss install hint">×</button>
                <p className="pr-5 text-sm font-semibold text-gray-900 dark:text-white">Install GB Maintenance</p>
                {installPrompt ? (
                  <>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-300">Add the application to your device for faster access.</p>
                    <button type="button" className="btn-primary mt-3" onClick={installApp}>Install app</button>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-300">Use your browser share menu and choose “Add to Home Screen”.</p>
                )}
              </div>
            )}
          </BrowserRouter>
        </NotificationsProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
