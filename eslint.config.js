// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'playtest/dist/', '.wrangler/'] },
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
    files: ['src/engine/**/*.ts'],
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
  {
    // Shared by the Worker and the browser: no DOM, no ambient time or randomness (time comes in
    // as `now`, secrets through SessionDeps), so GameSession stays deterministic and testable.
    files: ['src/net/**/*.ts'],
    ignores: ['src/net/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['pixi.js', 'pixi.js/*', '**/render/**'],
              message: 'No rendering on the server.',
            },
            {
              group: ['**/ui/hud', '**/ui/index', '**/ui/setup/screen'],
              message: 'No DOM on the server.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use SessionDeps.' },
        { object: 'Date', property: 'now', message: 'Pass `now` in.' },
        { object: 'performance', property: 'now', message: 'Pass `now` in.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Pass `now` in.' },
        { name: 'window', message: 'No DOM on the server.' },
        { name: 'document', message: 'No DOM on the server.' },
        { name: 'setTimeout', message: 'The transport schedules ticks (nextWakeAt).' },
        { name: 'setInterval', message: 'The transport schedules ticks (nextWakeAt).' },
      ],
    },
  },
  prettier,
);
