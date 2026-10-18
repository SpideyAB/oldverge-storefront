import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/', 'node_modules/', 'coverage/', 'supabase/functions/**/*.ts'] },   // Deno entrypoints (no TypeScript parser configured)
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Only the two classic hook rules. The plugin's React Compiler rules (set-state-in-effect, refs,
      // static-components, ...) flag established patterns in this codebase as style findings; they are not
      // enabled until the project decides to adopt the React Compiler.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // ESLint already counts <motion.div> as a use of `motion`, so only underscore-prefixed names are exempt.
      'no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['*.config.js', 'scripts/**/*.{js,mjs}', 'supabase/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.test.{js,jsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
];
