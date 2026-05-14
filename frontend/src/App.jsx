import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { NotificationsProvider } from './contexts/NotificationsContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ToastContainer } from './components/Toast'

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

const P = ({ children, perm }) => <ProtectedRoute permission={perm}>{children}</ProtectedRoute>

export default function App() {
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
              <Route path="/assets/:id" element={<P perm="assets"><AssetDetail /></P>} />
              <Route path="/services" element={<P perm="services"><Services /></P>} />
              <Route path="/services/:id" element={<P perm="services"><ServiceDetail /></P>} />
              <Route path="/maintenance" element={<P perm="maintenance"><Maintenance /></P>} />
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
