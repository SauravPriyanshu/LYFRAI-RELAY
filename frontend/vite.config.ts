import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// envDir '..' lets `npm run dev` read VITE_* values from the repo-root .env.
// In Docker/CI, real environment variables (build args) take precedence.
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  server: { port: 3000, host: true },
  preview: { port: 3000, host: true },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['**/node_modules/**', '**/e2e/**', '**/dist/**'],
  },
})
