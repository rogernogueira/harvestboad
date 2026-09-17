import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // 8002: as portas 8000 e 8001 já são usadas por outros serviços nesta máquina
        target: 'http://localhost:8002',
        changeOrigin: true,
      },
    },
  },
})
