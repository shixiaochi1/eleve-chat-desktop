import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  base: './',
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          xterm: ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
          marked: ['marked'],
          dompurify: ['dompurify'],
          virtual: ['@tanstack/react-virtual'],
          radix: [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-collapsible',
            '@radix-ui/react-context-menu',
            '@radix-ui/react-separator',
            '@radix-ui/react-switch',
            '@radix-ui/react-scroll-area',
          ],
          lucide: ['lucide-react'],
          cmdk: ['cmdk'],
        },
      },
    },
  },
  esbuild: {
    target: 'esnext',
  },
  server: {
    host: '127.0.0.1',
    port: 24242,
    strictPort: true,
  },
})
