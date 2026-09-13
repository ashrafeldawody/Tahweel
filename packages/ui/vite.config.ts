import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const SERVER_ORIGIN = 'http://localhost:3000';
const PROXIED_PREFIXES = ['/admin', '/health', '/docs', '/docs-json', '/api', '/ingest'];

const proxy = Object.fromEntries(PROXIED_PREFIXES.map((prefix) => [prefix, { target: SERVER_ORIGIN, changeOrigin: true }]));

export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mantine: ['@mantine/core', '@mantine/hooks', '@mantine/notifications'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    css: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
