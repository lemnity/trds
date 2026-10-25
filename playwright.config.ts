import { defineConfig, devices } from '@playwright/test'

/**
 * E2E (T-070, HTTP-часть T-071): `pnpm test:e2e`. Окружение — tests/e2e/global-setup.ts
 * (одноразовый PostgreSQL, миграции, сид, `next dev` с учебным банком на свободном порту).
 * Браузер — только Chromium (`pnpm exec playwright install chromium`).
 */

const CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  outputDir: 'test-results',
  // Один dev-сервер на прогон: два воркера — баланс скорости и стабильности компиляции маршрутов.
  workers: 2,
  fullyParallel: true,
  forbidOnly: CI,
  // В CI один повтор — сбой первой компиляции маршрута под нагрузкой; повтор виден в отчёте как flaky.
  retries: CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: CI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    locale: 'ru-RU',
    timezoneId: 'Asia/Yekaterinburg',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
