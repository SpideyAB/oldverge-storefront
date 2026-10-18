import { defineConfig } from 'vitest/config';

// Database tests: real PostgreSQL (embedded), migrations applied from supabase/migrations.
// Run with `npm run test:db`. Kept separate from the fast unit tests (`npm test`).
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.js'],
    environment: 'node',
    globalSetup: ['./supabase/tests/support/global-setup.js'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
  },
});
