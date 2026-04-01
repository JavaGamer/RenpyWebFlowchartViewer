import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  base: '/RenpyWebFlowchartViewer/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Browser stubs for Node.js built-ins used by @renpy/ast
      'node:fs/promises': resolve(__dirname, 'src/stubs/fs-stub.ts'),
      'node:fs': resolve(__dirname, 'src/stubs/fs-stub.ts'),
      console: resolve(__dirname, 'src/stubs/console-stub.ts'),
    },
  },
  optimizeDeps: {
    include: ['@renpy/ast'],
  },
})
