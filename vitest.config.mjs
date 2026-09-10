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
    /**
     * The same reasoning as `hookTimeout`, for the tests themselves.
     *
     * Nearly every test here drives real SQLite through the domain services, and
     * Vitest runs test files in parallel. Measured on an idle machine, a test
     * that takes 400ms with its file running alone takes four to nine seconds
     * when its directory runs together — so the five-second default leaves most
     * of this suite sitting on a cliff edge, and it fell off often enough to
     * make the suite untrustworthy whenever anything else used the CPU.
     *
     * Raising the default is the fix rather than annotating hundreds of tests:
     * twenty-three files rely on it, and the timeout was never the thing those
     * tests were asserting. The handful of genuinely heavy tests still carry
     * their own larger budgets. A test that truly hangs still fails in a minute.
     */
    testTimeout: 60_000,
  },
});
