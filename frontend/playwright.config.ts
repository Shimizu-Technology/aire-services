import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from frontend directory
dotenv.config({ path: resolve(__dirname, '.env') });

/**
 * Playwright Configuration
 * 
 * Run tests: npm test
 * Run with UI: npm run test:ui
 * Run headed: npm run test:headed
 * Debug: npm run test:debug
 */
export default defineConfig({
  testDir: './e2e',
  
  // Run tests in parallel
  fullyParallel: true,
  
  // Fail CI if test.only left in code
  forbidOnly: !!process.env.CI,
  
  // Retry failed tests in CI
  retries: process.env.CI ? 2 : 0,
  
  // Workers
  workers: process.env.CI ? 1 : undefined,
  
  // Reporter
  reporter: [
    ['html', { open: 'never' }],
    ['list']
  ],
  
  // Shared settings for all projects
  use: {
    // Base URL for all tests
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    
    // Collect trace on first retry
    trace: 'on-first-retry',
    
    // Screenshot on failure
    screenshot: 'only-on-failure',
    
    // Video on failure
    video: 'on-first-retry',
  },

  projects: [
    // Setup project - authenticates and saves state
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    
    // Desktop Chrome - authenticated tests
    {
      name: 'chromium',
      testIgnore: /.*\.public\.spec\.ts/, // Don't run public tests with auth
      use: { 
        ...devices['Desktop Chrome'],
        // Use saved auth state
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    
    // Mobile Chrome - authenticated tests  
    {
      name: 'mobile-chrome',
      testIgnore: /.*\.public\.spec\.ts/, // Don't run public tests with auth
      use: { 
        ...devices['Pixel 5'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    
    // Public pages - no auth needed (desktop)
    {
      name: 'public',
      testMatch: /.*\.public\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    
    // Public pages - no auth needed (mobile)
    {
      name: 'public-mobile',
      testMatch: /.*\.public\.spec\.ts/,
      use: { ...devices['Pixel 5'] },
    },
  ],

  // Start local dev server before tests
  webServer: {
    command: 'npm run dev',
    url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
});
