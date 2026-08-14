/**
 * ESLint configuration.
 *
 * `.cjs` rather than `.eslintrc.json` so the reasoning can live next to the
 * rules — a silenced rule with no explanation is indistinguishable from one
 * that was silenced out of laziness.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  env: { node: true, es2022: true },

  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'smart'],
    'no-var': 'error',
    'prefer-const': 'error',

    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/consistent-type-imports': 'warn',

    // These two matter most in an Express app: a dropped promise means a
    // request that silently never completes, or an error that never surfaces.
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': [
      'error',
      { checksVoidReturn: { arguments: false, attributes: false } },
    ],

    // Express types `req.body`, `req.query` and `req.params` as `any`, so the
    // unsafe-* family fires on every unvalidated read. The real fix is a Zod
    // schema at the boundary (src/validators) — so these are warnings that
    // should trend toward zero as the phase-tagged TODOs are completed, rather
    // than errors that get blanket-disabled and stop meaning anything.
    '@typescript-eslint/no-unsafe-assignment': 'warn',
    '@typescript-eslint/no-unsafe-member-access': 'warn',
    '@typescript-eslint/no-unsafe-argument': 'warn',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
  },

  overrides: [
    {
      // Controllers, middleware and services are uniformly `async` by
      // convention: `asyncHandler` wraps them consistently, and adding an
      // await later must not change a signature. `require-await` fights that
      // deliberate choice.
      files: ['src/controllers/**/*.ts', 'src/middleware/**/*.ts', 'src/services/**/*.ts'],
      rules: { '@typescript-eslint/require-await': 'off' },
    },
    {
      // Seeds and build scripts are operator-facing tools; printing is the point.
      files: ['prisma/seed.ts', 'scripts/**/*.mjs'],
      rules: {
        'no-console': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
      },
    },
    {
      // supertest returns `any` throughout; asserting on it is the whole job.
      files: ['tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
      },
    },
  ],

  ignorePatterns: [
    'dist/',
    'node_modules/',
    'coverage/',
    'public/js/app.js',
    '*.min.css',
    '*.config.ts',
  ],
};
