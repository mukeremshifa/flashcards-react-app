import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Vite warns at 500 kB. The eager chunk is past that and is staying there:
    // the vendor floor is measured in docs/plans/P4-ship.md, and there is no
    // size target for this project. A warning nobody is allowed to act on is
    // noise that trains people to skim the build output.
    //
    // This raises the threshold; it does not disable reporting. Run
    // `npm run build` and read the chunk table when the dependency set changes.
    chunkSizeWarningLimit: 2000,
  },
});
