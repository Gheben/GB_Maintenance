import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4680',
        changeOrigin: true,
      },
      '/docs': {
        target: 'http://localhost:4680',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:4680',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:4680',
        ws: true,
      },
    },
  },
})
