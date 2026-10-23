import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/\/src\/i18n\/(en|zh)\.ts$/.test(id)) return 'locales'
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/xterm/') || id.includes('/@xterm/')) return 'xterm'
          if (id.includes('/lucide-react/')) return 'icons'
          return undefined
        },
      },
    },
  },
})
