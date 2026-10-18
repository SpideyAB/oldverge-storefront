import { defineConfig } from 'vitest/config';

// Fast unit tests for the storefront code. Database tests use vitest.db.config.js (npm run test:db).
export default defineConfig({
  test: {
    include: ['src/**/*.test.{js,jsx}', 'supabase/functions/**/*.test.{js,ts}'],
    environment: 'node',
  },
});
