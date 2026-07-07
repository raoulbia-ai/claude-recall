// Pragmatic ESLint config: catch real bugs, don't fight the existing style.
// The codebase predates the linter and uses `any` liberally at service
// boundaries (JSON values, better-sqlite3 rows, hook payloads) — banning it
// wholesale would bury real findings under thousands of style errors.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.jest-cache/**', '*.js', '*.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // tsconfig.test.json covers src + tests (the base tsconfig excludes tests)
        project: './tsconfig.test.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Style concessions to the existing codebase
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      '@typescript-eslint/no-require-imports': 'off', // dynamic require is deliberate in hooks/CLI

      // Real-bug rules worth paying for (type-aware)
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
    },
  },
  {
    // Tests: mocks and fixtures legitimately break more rules
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
);
