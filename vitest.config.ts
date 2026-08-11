import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Integration tests hit a real Postgres and are opt-in via env; see
    // src/test/rls.integration.test.ts.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
