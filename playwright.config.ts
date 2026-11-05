import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [
    {
      name: 'mobile-iphone',
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 3,
      },
    },
    {
      name: 'mobile-pixel',
      use: {
        viewport: { width: 393, height: 851 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'mobile-galaxy',
      use: {
        viewport: { width: 412, height: 915 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'desktop',
      use: {
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
