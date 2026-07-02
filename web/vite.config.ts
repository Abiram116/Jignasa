import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves this as a project page at /Jignasa/, not the domain
// root -- asset URLs need that prefix or they 404. Local dev and the Docker
// self-host build both serve from root, so this only applies to the
// VITE_STATIC_DEMO showcase build.
const isStaticDemo = process.env.VITE_STATIC_DEMO === 'true'

export default defineConfig({
  base: isStaticDemo ? '/Jignasa/' : '/',
  plugins: [
    react(),
    // Installability only -- not offline support. The point is a real app
    // window (its own icon, no address bar) via the browser's native
    // "Install app" flow, backed by the exact same FastAPI server and React
    // bundle as the browser tab, not a separate native wrapper. Skipped on
    // the static GitHub Pages showcase build since there's no backend behind
    // it -- "installing" a page that can't actually chat would be broken.
    !isStaticDemo &&
      VitePWA({
        registerType: 'autoUpdate',
        // Without this, the manifest/service worker only exist in a
        // production build (`npm run build`) -- the everyday `./run_all.sh`
        // dev-server flow on :5173 would never show an install prompt at
        // all, which defeats the point for anyone just running it locally.
        devOptions: { enabled: true, type: 'module' },
        // No runtimeCaching entries -- every /api/* request (including the
        // SSE chat stream) goes straight to the network, untouched by the
        // service worker. It only precaches the built JS/CSS/HTML so the
        // installed window has an icon and opens instantly; it must never
        // be able to serve a stale chat response or an old bundle silently.
        workbox: {
          navigateFallbackDenylist: [/^\/api/],
        },
        manifest: {
          name: 'Jignasa',
          short_name: 'Jignasa',
          description: 'A fully local, privacy-first RAG assistant powered by Ollama and FAISS',
          theme_color: '#07090f',
          background_color: '#07090f',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            { src: 'pwa-icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
