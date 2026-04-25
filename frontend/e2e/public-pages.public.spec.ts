import { test, expect } from '@playwright/test';

const publicRoutes = [
  { path: '/', heading: /Pilot training|Guam aerial tours|video packages/i },
  { path: '/programs', heading: /Pilot training|Programs/i },
  { path: '/team', heading: /Meet the people|Meet the instructors|Team/i },
  { path: '/discovery-flight', heading: /discovery flight/i },
  { path: '/careers', heading: /Join the AIRE team|Careers/i },
  { path: '/contact', heading: /Talk with AIRE|Contact/i },
];

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const metrics = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));

  expect(metrics.doc).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1);
}

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

    await expect(page).toHaveTitle(/Team \| AIRE Services Guam/i);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('discovery flight page loads', async ({ page }) => {
    await page.goto('/discovery-flight');

    await expect(page).toHaveTitle(/Discovery Flight \| AIRE Services Guam/i);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('careers page loads', async ({ page }) => {
    await page.goto('/careers');

    await expect(page).toHaveTitle(/Careers \| AIRE Services Guam/i);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('contact page loads', async ({ page }) => {
    await page.goto('/contact');

    await expect(page).toHaveTitle(/Contact \| AIRE Services Guam/i);
    await expect(page.locator('form')).toBeVisible();
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
        await page.locator(`a:has-text("${name}"):visible`).first().click();
      } else {
        await page.locator(`nav a:has-text("${name}")`).first().click();
      }
    };

    await clickNavLink('Programs');
    await expect(page).toHaveURL(/\/programs/);

    await clickNavLink('Contact');
    await expect(page).toHaveURL(/\/contact/);
  });

  test('desktop pages render without horizontal overflow', async ({ page }) => {
    for (const route of publicRoutes) {
      await page.goto(route.path);
      await expect(page.locator('h1').first()).toContainText(route.heading);
      await expectNoHorizontalOverflow(page);
    }
  });
});

test.describe('Mobile Responsiveness', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('mobile navigation works', async ({ page }) => {
    await page.goto('/');

    const menuButton = page.locator('[aria-label="Toggle menu"]');

    await expect(menuButton).toBeVisible();
    await menuButton.click();

    const mobileMenu = page.locator('a:has-text("Programs"):visible');
    await expect(mobileMenu.first()).toBeVisible({ timeout: 5000 });
  });

  test('public pages stack cleanly on mobile without overflow', async ({ page }) => {
    for (const route of publicRoutes) {
      await page.goto(route.path);
      await expect(page.locator('h1').first()).toContainText(route.heading);
      await expectNoHorizontalOverflow(page);
    }
  });
});
