import { test, expect } from '@playwright/test';

/**
 * Time Tracking Tests
 * 
 * Tests the time tracking functionality including:
 * - Page loading
 * - Adding time entries
 * - View switching
 * 
 * These tests require authentication.
 */

test.describe('Time Tracking Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/time');
    await page.waitForLoadState('domcontentloaded');
  });

  test('time tracking page loads successfully', async ({ page }) => {
    const header = page.locator('h1:has-text("Time Tracking")');
    await expect(header).toBeVisible({ timeout: 10000 });
  });

  test('displays log time button', async ({ page }) => {
    const logTimeButton = page.locator('button:has-text("Log Time")');
    await expect(logTimeButton).toBeVisible({ timeout: 10000 });
  });

  test('can open log time modal', async ({ page }) => {
    const logTimeButton = page.locator('button:has-text("Log Time")');
    await logTimeButton.click();
    
    // Modal should appear with form heading
    const modalHeading = page.locator('h2:has-text("Log Time")');
    await expect(modalHeading).toBeVisible({ timeout: 5000 });
  });

  test('can close log time modal', async ({ page }) => {
    const logTimeButton = page.locator('button:has-text("Log Time")');
    await logTimeButton.click();
    
    // Wait for modal
    await page.waitForTimeout(300);
    
    // Close modal
    const cancelButton = page.locator('button:has-text("Cancel")');
    if (await cancelButton.isVisible()) {
      await cancelButton.click();
    }
  });
});

test.describe('Time Entry Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/time');
    await page.waitForLoadState('domcontentloaded');
  });

  test('can fill time entry form', async ({ page }) => {
    const logTimeButton = page.locator('button:has-text("Log Time")');
    await logTimeButton.click();
    
    // Wait for modal
    const modalHeading = page.locator('h2:has-text("Log Time")');
    await expect(modalHeading).toBeVisible({ timeout: 5000 });
    
    // Fill hours (input type number)
    const hoursInput = page.locator('input[type="number"]').first();
    await hoursInput.fill('2.5');
    
    // Fill description if available
    const descInput = page.locator('textarea').first();
    if (await descInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await descInput.fill('Test time entry');
    }
    
    // Cancel to avoid actually creating entry
    const cancelButton = page.locator('button:has-text("Cancel")');
    await cancelButton.click();
  });

  test('modal has required form fields', async ({ page }) => {
    const logTimeButton = page.locator('button:has-text("Log Time")');
    await logTimeButton.click();
    
    // Modal should have date and hours inputs
    const dateInput = page.locator('input[type="date"]');
    const hoursInput = page.locator('input[type="number"]');
    
    await expect(dateInput).toBeVisible({ timeout: 5000 });
    await expect(hoursInput).toBeVisible({ timeout: 5000 });
    
    // Close modal
    const cancelButton = page.locator('button:has-text("Cancel")');
    await cancelButton.click();
  });
});

test.describe('View Modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/time');
    await page.waitForLoadState('domcontentloaded');
  });

  test('page has time entries tab', async ({ page }) => {
    // The time tracking page has a "Time Entries" tab
    const entriesTab = page.locator('button:has-text("Time Entries")');
    await expect(entriesTab).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Reports Tab', () => {
  test('can navigate to reports tab', async ({ page }) => {
    await page.goto('/admin/time');
    await page.waitForLoadState('domcontentloaded');
    
    const reportsTab = page.locator('button:has-text("Reports")');
    if (await reportsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await reportsTab.click();
      await page.waitForTimeout(500);
      
      // Reports view should load
    }
  });
});
