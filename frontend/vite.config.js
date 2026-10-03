import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In development the browser talks to Vite, and Vite forwards /api to the backend,
// so there are no cross-origin (CORS) problems.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': process.env.API_URL || 'http://localhost:8000' },
  },
})
