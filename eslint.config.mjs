import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // rules.md §9: не подавлять ошибки типов через any / ts-ignore без обоснования.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  globalIgnores([
    '.next/**',
    // e2e: сборка dev-сервера, рабочие файлы и отчёты Playwright.
    '.next-e2e/**',
    '.e2e/**',
    'playwright-report/**',
    'test-results/**',
    'node_modules/**',
    'next-env.d.ts',
    // Генерируются Payload — не редактируются вручную.
    'src/app/(payload)/**',
    'src/payload-types.ts',
  ]),
])
