import { test, expect } from '@playwright/test';

/**
 * Admin Dashboard Tests
 *
 * These tests require authentication (use saved auth state).
 * They cover the currently supported AIRE admin surfaces.
 */

test.describe('Admin Dashboard', () => {
  const clickSidebarLink = async (page: import('@playwright/test').Page, name: string) => {
    const mobileMenuButton = page.locator('button.lg\\:hidden').first();

    if (await mobileMenuButton.isVisible()) {
      await mobileMenuButton.click();
      await page.waitForTimeout(300);
      await page.locator(`.fixed.inset-y-0 a:has-text("${name}")`).click();
    } else {
      await page.locator(`.lg\\:fixed.lg\\:inset-y-0 a:has-text("${name}")`).click();
    }
  };

  test('dashboard loads and shows overview', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('main h1').first()).toContainText(/Operations Dashboard|Dashboard/i);
    await expect(page.locator('text=Who’s Working').first()).toBeVisible();
  });

  test('sidebar navigation works for current admin routes', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await clickSidebarLink(page, 'Time Tracking');
    await expect(page).toHaveURL(/\/admin\/time/);

    await clickSidebarLink(page, 'Schedule');
    await expect(page).toHaveURL(/\/admin\/schedule/);

    await clickSidebarLink(page, 'Dashboard');
    await expect(page).toHaveURL('/admin');
  });
});

test.describe('Time Tracking', () => {
  test('time tracking page loads', async ({ page }) => {
    await page.goto('/admin/time');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1').first()).toContainText(/Time/i);
  });

  test('can switch between day and week view', async ({ page }) => {
    await page.goto('/admin/time');

    const dayButton = page.locator('button:has-text("Day")');
    const weekButton = page.locator('button:has-text("Week")');

    if (await weekButton.isVisible()) {
      await weekButton.click();
    }

    if (await dayButton.isVisible()) {
      await dayButton.click();
    }
  });
});

test.describe('Schedule', () => {
  test('schedule page loads', async ({ page }) => {
    await page.goto('/admin/schedule');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1').first()).toContainText(/Schedule/i);
  });
});

test.describe('User Management (Admin Only)', () => {
  test('users page loads', async ({ page }) => {
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1').first()).toContainText(/User Management|Users/i);
  });

  test('can see invite user button', async ({ page }) => {
    await page.goto('/admin/users');
    await page.waitForLoadState('networkidle');

    const inviteButton = page.locator('button:has-text("Invite"), button:has-text("Add User")');
    await expect(inviteButton.first()).toBeVisible();
  });
});
