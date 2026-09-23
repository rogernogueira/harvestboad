import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Caminhos relativos: o painel é publicado como arquivo estático e não sabe
  // em que prefixo vai parar.
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dashboard',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (info) =>
          info.names?.[0]?.endsWith('.css') ? 'assets/app.css' : 'assets/[name][extname]',
      },
    },
  },
  // O duckdb-wasm traz workers pré-empacotados; deixar o Vite otimizá-los quebra
  // o importScripts do bundle escolhido em tempo de execução.
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
})
