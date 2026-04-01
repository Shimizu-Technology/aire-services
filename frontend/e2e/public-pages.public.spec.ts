import { test, expect } from '@playwright/test';

test.describe('Public Marketing Pages', () => {
  test('home page loads and displays content', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('nav')).toBeVisible();
  });

  test('programs page loads', async ({ page }) => {
    await page.goto('/programs');

    await expect(page.locator('h1')).toContainText(/Programs|Training/i);
  });

  test('team page loads', async ({ page }) => {
    await page.goto('/team');

    await expect(page.locator('h1')).toContainText(/Team/i);
  });

  test('discovery flight page loads', async ({ page }) => {
    await page.goto('/discovery-flight');

    await expect(page.locator('h1')).toContainText(/Discovery|Flight/i);
  });

  test('careers page loads', async ({ page }) => {
    await page.goto('/careers');

    await expect(page.locator('h1')).toContainText(/Careers/i);
  });

  test('contact page loads', async ({ page }) => {
    await page.goto('/contact');

    await expect(page.locator('h1')).toContainText(/Contact/i);
  });

  test('kiosk page loads', async ({ page }) => {
    await page.goto('/kiosk');

    await expect(page.locator('body')).toBeVisible();
  });

  test('navigation links work', async ({ page }) => {
    await page.goto('/');

    const clickNavLink = async (name: string) => {
      const mobileMenuButton = page.locator('[aria-label="Toggle menu"]');

      if (await mobileMenuButton.isVisible()) {
        await mobileMenuButton.click();
        await page.waitForTimeout(300);
        await page.locator(`a:has-text("${name}")`).first().click();
      } else {
        await page.locator(`nav a:has-text("${name}")`).first().click();
      }
    };

    await clickNavLink('Programs');
    await expect(page).toHaveURL(/\/programs/);

    await clickNavLink('Contact');
    await expect(page).toHaveURL(/\/contact/);
  });
});

test.describe('Mobile Responsiveness', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('mobile navigation works', async ({ page }) => {
    await page.goto('/');

    const menuButton = page.locator('[aria-label="Toggle menu"]');

    await expect(menuButton).toBeVisible();
    await menuButton.click();

    const mobileMenu = page.locator('text=Programs');
    await expect(mobileMenu.first()).toBeVisible({ timeout: 5000 });
  });
});
