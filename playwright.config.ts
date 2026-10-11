import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // Electron apps are launched programmatically, not via browsers.json
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    trace: 'off'
  }
})
