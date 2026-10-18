import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // PGlite (modo local) traz o seu próprio WebAssembly; não deve ser pré-empacotado.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], supabase: ['@supabase/supabase-js'] },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
})
