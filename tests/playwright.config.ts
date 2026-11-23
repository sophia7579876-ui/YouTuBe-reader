import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

const port = process.env.ATLAS_TEST_PORT ?? '3131'
const baseURL = 'http://127.0.0.1:' + port
export default defineConfig({
  testDir: '.',
  testMatch: 'browser.spec.ts',
  timeout: 150_000,
  expect: {timeout: 55_000},
  workers: 1,
  reporter: 'line',
  outputDir: process.env.ATLAS_BROWSER_OUTPUT ?? resolve('test-results'),
  use: {
    baseURL, actionTimeout:12_000, browserName:'chromium', viewport:{width:1440,height:1000},
    launchOptions:{executablePath:process.env.CHROMIUM_PATH},
  },
  webServer: {
    cwd: resolve('.'),
    command:'npm start',
    url:baseURL + '/api/health',
    timeout: 30_000,
    reuseExistingServer: false,
    env:{PORT:port, HOST:'127.0.0.1', ATLAS_DB:process.env.ATLAS_BROWSER_DB ?? resolve('.data/browser-test.sqlite')},
  },
})
