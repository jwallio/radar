import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function normalizeBasePath(value: string | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) return '/'
  if (trimmed === '.' || trimmed === './') return './'
  const withoutSlashes = trimmed.replace(/^\/+|\/+$/g, '')
  return withoutSlashes ? `/${withoutSlashes}/` : '/'
}

const configuredBasePath = normalizeBasePath(process.env.VITE_BASE_PATH ?? process.env.BASE_PATH)

// https://vite.dev/config/
export default defineConfig({
  base: configuredBasePath,
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/maplibre-gl')) return 'vendor-maplibre'
          if (id.includes('node_modules/@tanstack/react-query')) return 'vendor-query'
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react'
          return undefined
        },
      },
    },
    chunkSizeWarningLimit: 1100,
  },
})
