import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this as a project page at /Jignasa/, not the domain
// root -- asset URLs need that prefix or they 404. Local dev and the Docker
// self-host build both serve from root, so this only applies to the
// VITE_STATIC_DEMO showcase build.
const isStaticDemo = process.env.VITE_STATIC_DEMO === 'true'

export default defineConfig({
  base: isStaticDemo ? '/Jignasa/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
