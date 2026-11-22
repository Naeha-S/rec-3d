import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Single static base-path constant (PLAN.md §5.1 & §7).
 * Set GITHUB_PAGES=true (used automatically in .github/workflows/deploy.yml)
 * or change PAGES_BASE below when publishing under a subpath.
 */
export const PAGES_BASE = process.env.PAGES_BASE || '/rec-3d/';
export const BASE_PATH = process.env.GITHUB_PAGES === 'true' ? PAGES_BASE : '/';

export default defineConfig({
  base: BASE_PATH,
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
          vendor: ['react', 'react-dom', 'zod'],
        },
      },
    },
  },
});
