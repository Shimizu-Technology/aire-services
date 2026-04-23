import { test, expect } from '@playwright/test';

async function mockContactSubmit(page: import('@playwright/test').Page, options?: { delayMs?: number; responseBody?: Record<string, unknown> }) {
  await page.route('**/api/v1/contact', async (route) => {
    if (options?.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(options?.responseBody ?? {
        success: true,
        message: 'Your message has been sent successfully!',
      }),
    });
  });
}

test.describe('Contact Form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/contact');
    await expect(page).toHaveTitle(/Contact \| AIRE Services Guam/i);
    await expect(page.locator('h1')).toContainText(/Talk with AIRE/i);
    await expect(page.locator('form')).toBeVisible();
  });

  test('contact form loads with all required fields', async ({ page }) => {
    await expect(page.locator('input#name')).toBeVisible();
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.locator('select#subject')).toBeVisible();
    await expect(page.locator('textarea#message')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('displays direct contact links and location', async ({ page }) => {
    await expect(page.getByText('Direct contact information')).toBeVisible();
    await expect(page.locator('a[href="tel:+16714774243"]')).toBeVisible();
    await expect(page.locator('a[href="mailto:admin@aireservicesguam.com"]')).toBeVisible();
    await expect(page.getByText(/Admiral Sherman Boulevard/i).first()).toBeVisible();
  });

  test('validates required fields before submission', async ({ page }) => {
    await page.click('button[type="submit"]');

    const nameInput = page.locator('input#name');
    const isInvalid = await nameInput.evaluate((el: HTMLInputElement) => !el.checkValidity());
    expect(isInvalid).toBeTruthy();
  });

  test('validates email format', async ({ page }) => {
    await page.fill('input#name', 'Test User');
    await page.fill('input#email', 'invalid-email');
    await page.selectOption('select#subject', { index: 1 });
    await page.fill('textarea#message', 'Test message');

    await page.click('button[type="submit"]');

    const emailInput = page.locator('input#email');
    const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.checkValidity());
    expect(isInvalid).toBeTruthy();
  });

  test('can fill and submit the contact form successfully', async ({ page }) => {
    await mockContactSubmit(page);

    await page.fill('input#name', 'Test User');
    await page.fill('input#email', `test-${Date.now()}@example.com`);
    await page.fill('input#phone', '671-555-1234');
    await page.selectOption('select#subject', { index: 1 });
    await page.fill('textarea#message', 'This is a test message from automated e2e tests.');

    await page.click('button[type="submit"]');

    await expect(page.getByText(/sent successfully/i)).toBeVisible({ timeout: 10000 });
  });

  test('shows a loading state during submission', async ({ page }) => {
    await mockContactSubmit(page, { delayMs: 400 });

    await page.fill('input#name', 'Test User');
    await page.fill('input#email', 'test@example.com');
    await page.selectOption('select#subject', { index: 1 });
    await page.fill('textarea#message', 'Test message');

    const submitButton = page.locator('button[type="submit"]');
    await submitButton.click();

    await expect(submitButton).toContainText(/Sending/i);
    await expect(submitButton).toBeDisabled();
  });

  test('can select different subject options', async ({ page }) => {
    const subjectSelect = page.locator('select#subject');
    const options = await subjectSelect.locator('option').all();

    expect(options.length).toBeGreaterThan(1);

    for (let i = 1; i < Math.min(options.length, 4); i++) {
      await subjectSelect.selectOption({ index: i });
      const selectedValue = await subjectSelect.inputValue();
      expect(selectedValue).toBeTruthy();
    }
  });

  test('has a quick link to the discovery flight page', async ({ page }) => {
    const discoveryLink = page.getByRole('link', { name: /Explore Discovery Flight/i });
    await expect(discoveryLink).toBeVisible();

    await discoveryLink.click();
    await expect(page).toHaveURL(/\/discovery-flight/);
  });
});

test.describe('Contact Form Edge Cases', () => {
  test('handles special characters in name and message', async ({ page }) => {
    await mockContactSubmit(page);
    await page.goto('/contact');

    await page.fill('input#name', "María O'Connor-García");
    await page.fill('input#email', 'test@example.com');
    await page.selectOption('select#subject', { index: 1 });
    await page.fill('textarea#message', 'Test with special chars: < > & " \' © ®');

    await page.click('button[type="submit"]');

    await expect(page.getByText(/sent successfully/i)).toBeVisible({ timeout: 10000 });
  });

  test('handles a very long message', async ({ page }) => {
    await mockContactSubmit(page);
    await page.goto('/contact');

    const longMessage = 'This is a very long test message. '.repeat(50);

    await page.fill('input#name', 'Test User');
    await page.fill('input#email', 'test@example.com');
    await page.selectOption('select#subject', { index: 1 });
    await page.fill('textarea#message', longMessage);

    await page.click('button[type="submit"]');

    await expect(page.getByText(/sent successfully/i)).toBeVisible({ timeout: 10000 });
  });

  test('trims whitespace from inputs before submitting', async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;

    await page.route('**/api/v1/contact', async (route) => {
      capturedBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Your message has been sent successfully!' }),
      });
    });

    await page.goto('/contact');

    await page.fill('input#name', '  Test User  ');
    await page.fill('input#email', '  test@example.com  ');
    await page.fill('input#phone', '  671-555-1234  ');
    await page.selectOption('select#subject', { index: 1 });
    await page.fill('textarea#message', '  Test message  ');

    await page.click('button[type="submit"]');

    await expect(page.getByText(/sent successfully/i)).toBeVisible({ timeout: 10000 });
    expect(capturedBody).toEqual({
      name: 'Test User',
      email: 'test@example.com',
      phone: '671-555-1234',
      subject: 'Discovery Flight',
      message: 'Test message',
    });
  });
});
