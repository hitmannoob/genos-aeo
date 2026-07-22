import nextTypescript from 'eslint-config-next/typescript';

export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'build/**',
      'coverage/**',
      'eslint.config.mjs',
    ],
  },
  ...nextTypescript,
  {
    rules: {
      // Existing codebase uses broad provider/API payload types heavily; keep
      // typecheck strict and avoid making lint unusable on historical `any`s.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'prefer-const': 'off',
    },
  },
];
