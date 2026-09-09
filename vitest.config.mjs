import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Native module: tests use a Node stand-in with the same UUID contract.
      'expo-crypto': fileURLToPath(new URL('./test/support/expo-crypto.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    /**
     * Setup hooks here create on-disk SQLite databases and run every migration,
     * sometimes three of them for a three-device fixture. That is I/O bound, and
     * with the whole suite running in parallel it can take far longer than the
     * ten-second default on a loaded machine. The budget is for slow hardware,
     * not for slow code: a hook that genuinely hangs still fails.
     */
    hookTimeout: 60_000,
  },
});
