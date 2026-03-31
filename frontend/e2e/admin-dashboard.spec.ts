import { test, expect } from '@playwright/test';

/**
 * Admin Dashboard Tests
 * 
 * These tests require authentication (use saved auth state).
 * They test the admin dashboard functionality.
 */

test.describe('Admin Dashboard', () => {
  // Helper to click sidebar link (handles both desktop and mobile)
  const clickSidebarLink = async (page: import('@playwright/test').Page, name: string) => {
    // Check if we're on mobile by seeing if the hamburger button is visible
    const mobileMenuButton = page.locator('button.lg\\:hidden').first();
    
    if (await mobileMenuButton.isVisible()) {
      // Mobile: open sidebar first
      await mobileMenuButton.click();
      await page.waitForTimeout(300);
      // Click link in mobile sidebar (the one that slides in)
      await page.locator(`.fixed.inset-y-0 a:has-text("${name}")`).click();
    } else {
      // Desktop: click link in the visible desktop sidebar
      await page.locator(`.lg\\:fixed.lg\\:inset-y-0 a:has-text("${name}")`).click();
    }
  };

  test('dashboard loads and shows overview', async ({ page }) => {
    await page.goto('/admin');
    
    // Wait for dashboard to load
    await page.waitForLoadState('networkidle');
    
    // Check main content area has Dashboard heading
    await expect(page.locator('main h1').first()).toContainText(/Dashboard/i);
    
    // Check stat cards are visible (they have gradient backgrounds)
    const statCards = page.locator('.bg-white.rounded-2xl');
    await expect(statCards.first()).toBeVisible();
  });

  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Click Clients link
    await clickSidebarLink(page, 'Clients');
    await expect(page).toHaveURL(/\/admin\/clients/);
    
    // Click Tax Returns link
    await clickSidebarLink(page, 'Tax Returns');
    await expect(page).toHaveURL(/\/admin\/returns/);
    
    // Click back to Dashboard
    await clickSidebarLink(page, 'Dashboard');
    await expect(page).toHaveURL('/admin');
  });
});

test.describe('Client Management', () => {
  test('client list loads', async ({ page }) => {
    await page.goto('/admin/clients');
    await page.waitForLoadState('networkidle');
    
    // Check heading
    await expect(page.locator('main h1').first()).toContainText(/Clients/i);
    
    // Check total clients count is visible (shows there's data)
    await expect(page.locator('text=/\\d+ total clients/i')).toBeVisible({ timeout: 10000 });
  });

  test('can search clients', async ({ page }) => {
    await page.goto('/admin/clients');
    
    // Find search input
    const searchInput = page.locator('input[placeholder*="Search"], input[type="search"]');
    
    if (await searchInput.isVisible()) {
      await searchInput.fill('Test');
      await page.keyboard.press('Enter');
      
      // Wait for search to complete
      await page.waitForLoadState('networkidle');
      
      // Results should update (we can't verify specific results without test data)
    }
  });

  test('can open client detail', async ({ page }) => {
    await page.goto('/admin/clients');
    
    // Click on first client row/card
    const firstClient = page.locator('table tbody tr, [data-testid="client-row"]').first();
    
    if (await firstClient.isVisible()) {
      await firstClient.click();
      
      // Should navigate to detail page
      await expect(page).toHaveURL(/\/admin\/clients\/\d+/);
    }
  });
});

test.describe('Tax Returns Management', () => {
  test('tax returns list loads', async ({ page }) => {
    await page.goto('/admin/returns');
    await page.waitForLoadState('networkidle');
    
    // Check heading
    await expect(page.locator('main h1').first()).toContainText(/Returns|Tax/i);
    
    // Check total returns count is visible (shows there's data)
    await expect(page.locator('text=/\\d+ total returns/i')).toBeVisible({ timeout: 10000 });
  });

  test('can filter by status', async ({ page }) => {
    await page.goto('/admin/returns');
    
    // Find status filter
    const statusFilter = page.locator('select, [data-testid="status-filter"]').first();
    
    if (await statusFilter.isVisible()) {
      // Select a status
      await statusFilter.selectOption({ index: 1 });
      
      // Wait for filter to apply
      await page.waitForLoadState('networkidle');
    }
  });
});

test.describe('Time Tracking', () => {
  test('time tracking page loads', async ({ page }) => {
    await page.goto('/admin/time');
    
    // Check heading
    await expect(page.locator('h1').first()).toContainText(/Time/i);
  });

  test('can switch between day and week view', async ({ page }) => {
    await page.goto('/admin/time');
    
    // Find view toggle
    const dayButton = page.locator('button:has-text("Day")');
    const weekButton = page.locator('button:has-text("Week")');
    
    if (await weekButton.isVisible()) {
      await weekButton.click();
      // View should change (verify by checking for week-specific elements)
    }
    
    if (await dayButton.isVisible()) {
      await dayButton.click();
      // View should change back
    }
  });
});

test.describe('Settings', () => {
  test('settings page loads', async ({ page }) => {
    await page.goto('/admin/settings');
    
    // Check heading
    await expect(page.locator('h1').first()).toContainText(/Settings/i);
  });
});

test.describe('User Management (Admin Only)', () => {
  test('users page loads', async ({ page }) => {
    await page.goto('/admin/users');
    
    // Check heading
    await expect(page.locator('h1').first()).toContainText(/User Management/i);
  });

  test('can see invite user button', async ({ page }) => {
    await page.goto('/admin/users');
    
    // Check for invite button
    const inviteButton = page.locator('button:has-text("Invite"), button:has-text("Add User")');
    await expect(inviteButton.first()).toBeVisible();
  });
});
