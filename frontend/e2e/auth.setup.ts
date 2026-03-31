import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

/**
 * Authentication Setup
 * 
 * This test runs FIRST and saves the authenticated session.
 * All other tests reuse this session (no login per test).
 * 
 * Prerequisites:
 * 1. Create a test user in Clerk dashboard
 * 2. Enable "Bypass Client Trust" in user Settings (Clerk dashboard)
 * 3. Add credentials to frontend/.env (gitignored):
 *    TEST_USER_EMAIL=test-admin@yourcompany.com
 *    TEST_USER_PASSWORD=your-secure-password
 * 4. Make sure the test user has the correct role in your app
 * 
 * Important: Click your app's login button (e.g., "Staff Login") instead of
 * navigating directly to /admin to avoid Google OAuth redirect issues.
 */

setup('authenticate', async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  
  // Skip auth if no credentials provided
  if (!email || !password) {
    console.log('⚠️ No test credentials found. Skipping auth setup.');
    console.log('   Set TEST_USER_EMAIL and TEST_USER_PASSWORD in frontend/.env');
    
    // Save empty auth state so other tests can still run (for public pages)
    await page.context().storageState({ path: authFile });
    return;
  }

  console.log(`🔐 Authenticating as ${email}...`);

  // Navigate to the app homepage
  await page.goto('/');
  
  // Click "Staff Login" button in the header
  await page.click('a:has-text("Staff Login"), button:has-text("Staff Login")');
  
  // Wait for Clerk sign-in form to appear
  await page.waitForSelector('input[name="identifier"]', { timeout: 10000 });
  
  // Fill the email field (be specific - use name attribute)
  await page.fill('input[name="identifier"]', email);
  
  // Wait a moment for the form to register the input
  await page.waitForTimeout(300);
  
  // Click the Continue button (NOT "Continue with Google")
  // The main Continue button is typically the submit button for the form
  // Look for button that says exactly "Continue" with an arrow, not "Continue with Google"
  const continueButton = page.locator('button:has-text("Continue")').filter({ hasNotText: 'Google' });
  await continueButton.click();
  
  // Wait for password field to be enabled and visible
  await page.waitForSelector('input[name="password"]:not([disabled])', { timeout: 10000 });
  
  // Fill password
  await page.fill('input[name="password"]', password);
  
  // Wait a moment
  await page.waitForTimeout(300);
  
  // Click Continue/Sign in to submit
  const submitButton = page.locator('button:has-text("Continue")').filter({ hasNotText: 'Google' });
  await submitButton.click();
  
  // Wait for the Clerk modal to close and user to be logged in
  // Look for the user avatar or Dashboard link in nav
  await page.waitForSelector('a:has-text("Dashboard"), [aria-label="User menu"]', { timeout: 15000 });
  
  // Click Dashboard to navigate to admin area
  await page.click('a:has-text("Dashboard")');
  
  // Wait for dashboard to load
  await page.waitForURL('**/admin**', { timeout: 10000 });
  
  // Verify we're on the dashboard
  await expect(page.locator('h1:has-text("Dashboard")').first()).toBeVisible({ timeout: 10000 });
  
  console.log('✅ Authentication successful!');
  
  // Save auth state for other tests
  await page.context().storageState({ path: authFile });
});
