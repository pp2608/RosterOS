import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Restart the Vite dev server after changing this proxy.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
})
