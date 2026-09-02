import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT || 5191);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  globalTeardown: './tests/e2e/teardown.js',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'fr-FR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Le serveur de test sert le build : on vérifie exactement ce qui part en production.
    command: 'npm run build && node --env-file-if-exists=.env server.js',
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(port),
      NODE_ENV: 'test',
      PUBLIC_RATE_LIMIT_MAX: '200',
      ADMIN_LOGIN_RATE_LIMIT_MAX: '100'
    }
  }
});
