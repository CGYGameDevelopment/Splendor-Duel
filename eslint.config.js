// @ts-check
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

/**
 * Lint configuration for the monorepo.
 *
 * Deliberately narrow: this exists to catch the mistakes that are easy to make
 * in this codebase and expensive to debug, not to enforce a house style. In
 * particular `no-floating-promises` and `no-misused-promises` need type
 * information, which is why the TypeScript config is the type-checked preset.
 */
module.exports = tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'packages/ai-trainer/**', // Python: linted by ruff, see the CI workflow
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // The engine leans on exhaustive switches over discriminated unions, so an
      // unhandled case must be an error rather than a silent fallthrough.
      // A `default` branch counts as handling the remaining cases; without this
      // option the rule demands every union member be named even when the
      // default is deliberate.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],

      // Immutability is a stated architecture principle, and accidentally
      // rebinding a parameter is the usual way it gets broken. Property writes
      // are left alone: the server's Session objects are deliberately mutable.
      'no-param-reassign': 'error',

      // Prefix-underscore escape hatch for intentionally unused bindings, which
      // the sanitizers use when destructuring a field away.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // Off: it misjudges `\`level${level}\` as 'level1' | 'level2' | 'level3'`,
      // where the assertion is load-bearing — TypeScript widens the template
      // literal to `string` in that position, so --fix removed the assertions
      // and broke the build. A rule whose autofix does not compile is worse than
      // no rule.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',

      // Too noisy to enforce on existing code and not worth the churn here.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
  {
    // Tests build deliberately malformed payloads and partial states.
    files: ['**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  {
    // Build/test config files sit outside every tsconfig, so they cannot be
    // type-checked. Lint them with the untyped rules only.
    files: ['**/*.js', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      sourceType: 'commonjs',
      // Explicitly turn the project service back off: languageOptions merges
      // key-by-key with the type-checked block above, so spreading
      // disableTypeChecked alone leaves the parser still looking for a tsconfig.
      parserOptions: { projectService: false, project: null },
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
