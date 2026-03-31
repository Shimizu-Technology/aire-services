import { test, expect } from '@playwright/test';

/**
 * Public Pages Tests
 * 
 * These tests run WITHOUT authentication.
 * They test the marketing pages and public intake form.
 */

test.describe('Public Marketing Pages', () => {
  test('home page loads and displays content', async ({ page }) => {
    await page.goto('/');
    
    // Check main heading
    await expect(page.locator('h1').first()).toBeVisible();
    
    // Check navigation exists
    await expect(page.locator('nav')).toBeVisible();
    
    // Check key sections
    await expect(page.locator('text=Services, text=About')).toBeTruthy();
  });

  test('about page loads', async ({ page }) => {
    await page.goto('/about');
    
    // Check content
    await expect(page.locator('h1')).toContainText(/About|Cornerstone/i);
  });

  test('services page loads', async ({ page }) => {
    await page.goto('/services');
    
    // Check services are listed
    await expect(page.locator('h1')).toContainText(/Services/i);
  });

  test('contact page loads', async ({ page }) => {
    await page.goto('/contact');
    
    // Check contact form or info
    await expect(page.locator('h1')).toContainText(/Contact/i);
  });

  test('navigation links work', async ({ page }) => {
    await page.goto('/');
    
    // Helper to click a nav link (handles both desktop and mobile)
    const clickNavLink = async (name: string) => {
      const mobileMenuButton = page.locator('[aria-label="Toggle menu"]');
      
      // If on mobile, open the menu first
      if (await mobileMenuButton.isVisible()) {
        await mobileMenuButton.click();
        await page.waitForTimeout(300);
        // Click the link in mobile menu
        await page.locator(`.md\\:hidden a:has-text("${name}")`).click();
      } else {
        // Desktop - click the nav link directly
        await page.locator(`nav a:has-text("${name}")`).first().click();
      }
    };
    
    // Click About link
    await clickNavLink('About');
    await expect(page).toHaveURL(/\/about/);
    
    // Click Services link  
    await clickNavLink('Services');
    await expect(page).toHaveURL(/\/services/);
    
    // Click Contact link
    await clickNavLink('Contact');
    await expect(page).toHaveURL(/\/contact/);
  });
});

test.describe('Intake Form (Public Access)', () => {
  test('intake form loads', async ({ page }) => {
    await page.goto('/intake');
    
    // Check step title is visible (the form uses divs, not a <form> element)
    await expect(page.locator('h2:has-text("Client Information")')).toBeVisible();
    
    // Check progress bar exists
    await expect(page.locator('text=Step 1 of')).toBeVisible();
  });

  test('kiosk mode hides navigation', async ({ page }) => {
    await page.goto('/intake?mode=kiosk');
    
    // In kiosk mode, the header/nav should be hidden
    // Check that the form content is still visible
    await expect(page.locator('h2:has-text("Client Information")')).toBeVisible();
    
    // The IntakeHeader component should not render in kiosk mode
    // There should be no logo link back to home
    const logoLink = page.locator('header a[href="/"]');
    await expect(logoLink).toHaveCount(0);
  });

  test('form validation shows errors for empty required fields', async ({ page }) => {
    await page.goto('/intake');
    
    // Wait for form to load
    await expect(page.locator('h2:has-text("Client Information")')).toBeVisible();
    
    // Try to proceed without filling anything (button says "Continue")
    await page.click('button:has-text("Continue")');
    
    // Should show validation errors
    const errorMessages = page.locator('.text-red-500');
    await expect(errorMessages.first()).toBeVisible();
  });

  test('can fill first step of intake form', async ({ page }) => {
    await page.goto('/intake');
    
    // Wait for form to load
    await expect(page.locator('h2:has-text("Client Information")')).toBeVisible();
    
    // Fill basic info (field names are first_name, last_name, etc.)
    await page.fill('input[name="first_name"]', 'Test');
    await page.fill('input[name="last_name"]', 'User');
    await page.fill('input[name="date_of_birth"]', '1990-01-15');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="phone"]', '671-555-1234');
    await page.fill('textarea[name="mailing_address"]', '123 Test St, Hagatna, GU 96910');
    
    // Click continue
    await page.click('button:has-text("Continue")');
    
    // Should advance to next step (Tax Filing Info)
    await expect(page.locator('h2:has-text("Tax Filing Info")')).toBeVisible();
  });
});

test.describe('Mobile Responsiveness', () => {
  test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE

  test('mobile navigation works', async ({ page }) => {
    await page.goto('/');
    
    // Look for hamburger menu (mobile nav toggle)
    const menuButton = page.locator('[aria-label="Toggle menu"]');
    
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    
    // Wait for the mobile menu container to appear
    const mobileMenu = page.locator('.md\\:hidden >> text=About');
    await expect(mobileMenu).toBeVisible({ timeout: 5000 });
  });

  test('intake form is usable on mobile', async ({ page }) => {
    await page.goto('/intake');
    
    // Check step title is visible
    await expect(page.locator('h2:has-text("Client Information")')).toBeVisible();
    
    // Inputs should be tappable (visible and not obscured)
    const firstInput = page.locator('input[name="first_name"]');
    await expect(firstInput).toBeVisible();
    
    // Can type in input
    await firstInput.fill('Mobile Test');
    
    // Verify the value was entered
    await expect(firstInput).toHaveValue('Mobile Test');
  });
});
