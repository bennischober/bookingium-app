import { defineConfig } from '@playwright/test'

// I6 (MR-18): the canary run is the only suite that touches a real mailbox, so it lives outside
// the default `testDir` and has a config of its own. A plain `npx playwright test` never finds it.
// Run it on purpose, against a copy of the profile that holds the canary account:
//   BOOKINGIUM_CANARY=1 BOOKINGIUM_E2E_USER_DATA=<copy> npx playwright test -c playwright.canary.config.ts
export default defineConfig({
  testDir: './tests/e2e-canary',
  timeout: 300_000,
  workers: 1,
  fullyParallel: false,
  // a real server is never asked twice: no retry after a failed login
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'off'
  }
})
