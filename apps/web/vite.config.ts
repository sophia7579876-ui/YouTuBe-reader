import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: process.env.WEB_HOST ?? '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? '5173'),
    strictPort: true,
    proxy: {'/api': {target: 'http://127.0.0.1:' + (process.env.API_PORT ?? '3000'), timeout: 180_000, proxyTimeout: 180_000}},
  },
})
