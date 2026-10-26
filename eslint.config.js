// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'playtest/dist/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
    },
  },
  {
    // The engine must stay pure and deterministic: no DOM, no Pixi, no ambient randomness or time.
    // Expansion rules (src/expansions/<id>/engine) are engine code too (docs/EXPANSIONS.md §2).
    files: ['src/engine/**/*.ts', 'src/expansions/*/engine/**/*.ts'],
    languageOptions: { globals: { ...globals.es2021 } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['pixi.js', 'pixi.js/*'], message: 'Engine must not depend on Pixi.' },
            {
              group: ['**/render/**', '**/ui/**', '**/game/**', '**/bots/**'],
              message: 'Engine must not import from other layers.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG in state.rng.' },
        { object: 'Date', property: 'now', message: 'Engine must be deterministic.' },
        { object: 'performance', property: 'now', message: 'Engine must be deterministic.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Engine must be deterministic.' },
        { name: 'window', message: 'Engine must not touch the DOM.' },
        { name: 'document', message: 'Engine must not touch the DOM.' },
      ],
    },
  },
  prettier,
);
