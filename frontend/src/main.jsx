import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const CHUNK_RELOAD_KEY = 'gb_chunk_reload_attempted'

function isChunkLoadErrorMessage(msg) {
  const text = String(msg || '').toLowerCase()
  return text.includes('failed to fetch dynamically imported module')
    || text.includes('importing a module script failed')
    || text.includes('loading chunk')
}

function tryRecoverChunkLoadError(msg) {
  if (!isChunkLoadErrorMessage(msg)) return false
  try {
    const attempted = sessionStorage.getItem(CHUNK_RELOAD_KEY)
    if (attempted === '1') return false
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
  } catch {
    // Ignore storage errors and still try reload once.
  }
  window.location.reload()
  return true
}

window.addEventListener('error', (ev) => {
  tryRecoverChunkLoadError(ev?.message)
})

window.addEventListener('unhandledrejection', (ev) => {
  const reasonMessage = typeof ev?.reason === 'string'
    ? ev.reason
    : (ev?.reason?.message || '')
  tryRecoverChunkLoadError(reasonMessage)
})

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error:', error, info)
  }

  handleReload = () => {
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY)
    } catch {
      // Ignore storage errors.
    }
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
          <div className="max-w-md w-full text-center bg-white shadow rounded-xl p-6">
            <h1 className="text-lg font-semibold text-gray-900">Something went wrong</h1>
            <p className="mt-2 text-sm text-gray-600">
              The application encountered an unexpected error. Please reload the page.
            </p>
            <button className="btn-primary mt-4" onClick={this.handleReload}>Reload</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function getCachedBranding() {
  try {
    const raw = localStorage.getItem('public_branding_cache')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function applyBrandingToHead(branding) {
  if (!branding || typeof branding !== 'object') return

  const appName = String(branding.app_name || '').trim()
  const appImage = String(branding.app_brand_image_url || '').trim()

  if (appName) document.title = appName
  if (!appImage) return

  document.querySelectorAll('link[rel="icon"]').forEach(link => {
    link.href = appImage
  })

  let appleTouchLink = document.head.querySelector('link[rel="apple-touch-icon"]')
  if (!appleTouchLink) {
    appleTouchLink = document.createElement('link')
    appleTouchLink.setAttribute('rel', 'apple-touch-icon')
    document.head.appendChild(appleTouchLink)
  }
  appleTouchLink.href = appImage
}

applyBrandingToHead(getCachedBranding())

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
)
