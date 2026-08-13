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
    /*
     * Database tests boot Postgres compiled to WASM. A cold PGlite start is a few
     * seconds, and more than one booting concurrently across workers can exceed
     * Vitest's 5s default — which surfaces as a flaky timeout that reads like a
     * real assertion failure. Budget for the slow case; unit tests are unaffected
     * because they finish in milliseconds either way.
     */
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests hit a real Postgres and are opt-in via env; see
    // src/test/rls.integration.test.ts.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
