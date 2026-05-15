import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
