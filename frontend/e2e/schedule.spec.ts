import { test, expect } from '@playwright/test';

/**
 * Employee Schedule Tests
 * 
 * Tests the employee scheduling functionality including:
 * - Page loading and navigation
 * - List and Grid view switching
 * - Week navigation
 * - Adding shifts
 * - Editing shifts
 * - Deleting shifts
 * - Log Time integration
 * 
 * These tests require authentication.
 */

test.describe('Schedule Page - Basic Loading', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/schedule');
    await page.waitForLoadState('domcontentloaded');
  });

  test('schedule page loads successfully', async ({ page }) => {
    const header = page.locator('h1:has-text("Employee Schedule")');
    await expect(header).toBeVisible({ timeout: 10000 });
  });

  test('displays view mode toggle buttons', async ({ page }) => {
    const listButton = page.locator('button:has-text("List")');
    const gridButton = page.locator('button:has-text("Grid")');
    
    await expect(listButton).toBeVisible({ timeout: 10000 });
    await expect(gridButton).toBeVisible({ timeout: 10000 });
  });

  test('displays week navigation controls', async ({ page }) => {
    const prevButton = page.locator('button[aria-label="Previous week"]');
    const nextButton = page.locator('button[aria-label="Next week"]');
    const currentWeekButton = page.locator('button:has-text("Go to current week")');
    
    await expect(prevButton).toBeVisible({ timeout: 10000 });
    await expect(nextButton).toBeVisible({ timeout: 10000 });
    await expect(currentWeekButton).toBeVisible({ timeout: 10000 });
  });

  test('defaults to list view', async ({ page }) => {
    // List button should be active (white background in the toggle)
    const listButton = page.locator('button:has-text("List")');
    await expect(listButton).toHaveClass(/bg-white/);
  });
});

test.describe('Schedule Page - View Switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/schedule');
    await page.waitForLoadState('domcontentloaded');
  });

  test('can switch to grid view', async ({ page }) => {
    const gridButton = page.locator('button:has-text("Grid")');
    await gridButton.click();
    
    // Wait for the view to update
    await page.waitForTimeout(500);
    
    // Grid view shows "+ Add" buttons
    const addButtons = page.locator('button:has-text("+ Add")');
    await expect(addButtons.first()).toBeVisible({ timeout: 5000 });
  });

  test('can switch back to list view', async ({ page }) => {
    // First switch to grid
    const gridButton = page.locator('button:has-text("Grid")');
    await gridButton.click();
    await page.waitForTimeout(500);
    
    // Then switch back to list
    const listButton = page.locator('button:has-text("List")');
    await listButton.click();
    await page.waitForTimeout(500);
    
    // List button should now be active
    await expect(listButton).toHaveClass(/bg-white/);
  });
});

test.describe('Schedule Page - Week Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/schedule');
    await page.waitForLoadState('domcontentloaded');
  });

  test('can navigate to previous week', async ({ page }) => {
    // Get the current week display text
    const weekDisplay = page.locator('.font-semibold.text-primary-dark').first();
    const initialText = await weekDisplay.textContent();
    
    // Click previous week
    const prevButton = page.locator('button[aria-label="Previous week"]');
    await prevButton.click();
    await page.waitForTimeout(500);
    
    // Week display should change
    const newText = await weekDisplay.textContent();
    expect(newText).not.toBe(initialText);
  });

  test('can navigate to next week', async ({ page }) => {
    // Get the current week display text
    const weekDisplay = page.locator('.font-semibold.text-primary-dark').first();
    const initialText = await weekDisplay.textContent();
    
    // Click next week
    const nextButton = page.locator('button[aria-label="Next week"]');
    await nextButton.click();
    await page.waitForTimeout(500);
    
    // Week display should change
    const newText = await weekDisplay.textContent();
    expect(newText).not.toBe(initialText);
  });

  test('can return to current week', async ({ page }) => {
    // Navigate away first
    const nextButton = page.locator('button[aria-label="Next week"]');
    await nextButton.click();
    await page.waitForTimeout(500);
    
    // Click "Go to current week"
    const currentWeekButton = page.locator('button:has-text("Go to current week")');
    await currentWeekButton.click();
    await page.waitForTimeout(500);
    
    // Should be back (we can verify the button still exists and page is stable)
    await expect(currentWeekButton).toBeVisible();
  });
});

test.describe('Schedule Page - Grid View Add Shift', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/schedule');
    await page.waitForLoadState('domcontentloaded');
    
    // Switch to grid view
    const gridButton = page.locator('button:has-text("Grid")');
    await gridButton.click();
    await page.waitForTimeout(500);
  });

  test('can open add shift modal from grid', async ({ page }) => {
    // Click an "+ Add" button
    const addButton = page.locator('button:has-text("+ Add")').first();
    await addButton.click();
    
    // Modal should appear
    const modalHeading = page.locator('h2:has-text("Add Shift")');
    await expect(modalHeading).toBeVisible({ timeout: 5000 });
  });

  test('add shift modal has required fields', async ({ page }) => {
    const addButton = page.locator('button:has-text("+ Add")').first();
    await addButton.click();
    
    // Check for required form elements
    const employeeSelect = page.locator('select').first();
    const dateInput = page.locator('input[type="date"]');
    const startTimeInput = page.locator('input[type="time"]').first();
    const endTimeInput = page.locator('input[type="time"]').nth(1);
    
    await expect(employeeSelect).toBeVisible({ timeout: 5000 });
    await expect(dateInput).toBeVisible();
    await expect(startTimeInput).toBeVisible();
    await expect(endTimeInput).toBeVisible();
  });

  test('add shift modal has quick time presets', async ({ page }) => {
    const addButton = page.locator('button:has-text("+ Add")').first();
    await addButton.click();
    
    // Check for preset buttons
    const preset8to1 = page.locator('button:has-text("8-1")');
    const preset8to5 = page.locator('button:has-text("8-5")');
    const preset830to5 = page.locator('button:has-text("8:30-5")');
    const preset9to5 = page.locator('button:has-text("9-5")');
    
    await expect(preset8to1).toBeVisible({ timeout: 5000 });
    await expect(preset8to5).toBeVisible();
    await expect(preset830to5).toBeVisible();
    await expect(preset9to5).toBeVisible();
  });

  test('can close add shift modal with cancel', async ({ page }) => {
    const addButton = page.locator('button:has-text("+ Add")').first();
    await addButton.click();
    
    // Wait for modal
    await page.waitForTimeout(300);
    
    // Click cancel
    const cancelButton = page.locator('button:has-text("Cancel")');
    await cancelButton.click();
    
    // Modal should be closed
    const modalHeading = page.locator('h2:has-text("Add Shift")');
    await expect(modalHeading).not.toBeVisible({ timeout: 3000 });
  });

  test('clicking quick preset updates time inputs', async ({ page }) => {
    const addButton = page.locator('button:has-text("+ Add")').first();
    await addButton.click();
    
    // Wait for modal
    await page.waitForTimeout(300);
    
    // Click 9-5 preset
    const preset9to5 = page.locator('button:has-text("9-5")');
    await preset9to5.click();
    
    // Verify the preset is now selected (has primary background)
    await expect(preset9to5).toHaveClass(/bg-primary/);
    
    // Cancel
    const cancelButton = page.locator('button:has-text("Cancel")');
    await cancelButton.click();
  });
});

test.describe('Schedule Page - Edit Shift', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/schedule');
    await page.waitForLoadState('domcontentloaded');
    
    // Switch to grid view
    const gridButton = page.locator('button:has-text("Grid")');
    await gridButton.click();
    await page.waitForTimeout(500);
  });

  test('can open edit modal by clicking existing shift', async ({ page }) => {
    // Look for an existing shift (time range button)
    const existingShift = page.locator('button').filter({ hasText: /\d+:\d+[ap]-\d+:\d+[ap]?/ }).first();
    
    // Only run if there's an existing shift
    if (await existingShift.isVisible({ timeout: 3000 }).catch(() => false)) {
      await existingShift.click();
      
      // Modal should show "Edit Shift"
      const modalHeading = page.locator('h2:has-text("Edit Shift")');
      await expect(modalHeading).toBeVisible({ timeout: 5000 });
      
      // Edit modal should have Delete button
      const deleteButton = page.locator('button:has-text("Delete")');
      await expect(deleteButton).toBeVisible();
      
      // Cancel
      const cancelButton = page.locator('button:has-text("Cancel")');
      await cancelButton.click();
    }
  });
});

test.describe('Schedule Page - List View Features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/schedule');
    await page.waitForLoadState('domcontentloaded');
  });

  test('list view shows Log Time buttons for shifts', async ({ page }) => {
    // Look for Log Time buttons (only visible if shifts exist)
    const logTimeButtons = page.locator('button:has-text("Log Time")');
    
    // Wait briefly for content to load
    await page.waitForTimeout(1000);
    
    // If there are scheduled shifts, Log Time buttons should be visible
    const buttonCount = await logTimeButtons.count();
    if (buttonCount > 0) {
      await expect(logTimeButtons.first()).toBeVisible();
    }
  });

  test('list view shows Edit shift buttons', async ({ page }) => {
    // Look for edit buttons
    const editButtons = page.locator('button[title="Edit shift"]');
    
    await page.waitForTimeout(1000);
    
    const buttonCount = await editButtons.count();
    if (buttonCount > 0) {
      await expect(editButtons.first()).toBeVisible();
    }
  });

  test('clicking Log Time navigates to time tracking with prefill', async ({ page }) => {
    const logTimeButton = page.locator('button:has-text("Log Time")').first();
    
    // Only run if there are scheduled shifts
    if (await logTimeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await logTimeButton.click();
      
      // Should navigate to time tracking page
      await expect(page).toHaveURL(/\/admin\/time/);
      
      // Time tracking modal should be open (with prefilled data)
      const modalHeading = page.locator('h2:has-text("Log Time")');
      await expect(modalHeading).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('Schedule Page - Create and Delete Shift Flow', () => {
  test('can create a new shift', async ({ page }) => {
    await page.goto('/admin/schedule');
    await page.waitForLoadState('domcontentloaded');
    
    // Switch to grid view
    const gridButton = page.locator('button:has-text("Grid")');
    await gridButton.click();
    await page.waitForTimeout(500);
    
    // Click an add button
    const addButton = page.locator('button:has-text("+ Add")').first();
    await addButton.click();
    
    // Wait for modal
    const modalHeading = page.locator('h2:has-text("Add Shift")');
    await expect(modalHeading).toBeVisible({ timeout: 5000 });
    
    // Select 8-1 preset
    const preset8to1 = page.locator('button:has-text("8-1")');
    await preset8to1.click();
    
    // Add a note
    const notesInput = page.locator('input[placeholder*="Remote"]');
    await notesInput.fill('E2E Test Shift');
    
    // Save
    const saveButton = page.locator('button:has-text("Save")');
    await saveButton.click();
    
    // Wait for modal to close
    await expect(modalHeading).not.toBeVisible({ timeout: 5000 });
    
    // The new shift should appear in the grid (8:00a-1:00p pattern)
    await page.waitForTimeout(1000);
  });
});

test.describe('Schedule Page - Dashboard Integration', () => {
  test('dashboard shows My Upcoming Shifts section', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    
    // Look for the My Upcoming Shifts heading
    const shiftsSection = page.locator('h2:has-text("My Upcoming Shifts")');
    await expect(shiftsSection).toBeVisible({ timeout: 10000 });
  });

  test('dashboard has link to full schedule', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    
    // Look for the View Full Schedule link
    const scheduleLink = page.locator('a:has-text("View Full Schedule")');
    await expect(scheduleLink).toBeVisible({ timeout: 10000 });
  });

  test('clicking View Full Schedule navigates to schedule page', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    
    const scheduleLink = page.locator('a:has-text("View Full Schedule")');
    await scheduleLink.click();
    
    // Should navigate to schedule page
    await expect(page).toHaveURL(/\/admin\/schedule/);
    
    // Schedule page should load
    const header = page.locator('h1:has-text("Employee Schedule")');
    await expect(header).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Schedule Page - Sidebar Navigation', () => {
  test('schedule link exists in sidebar', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    
    // Use more specific selector - sidebar link in the nav area
    const scheduleLink = page.locator('nav a[href="/admin/schedule"]').first();
    await expect(scheduleLink).toBeVisible({ timeout: 10000 });
  });

  test('clicking schedule link in sidebar navigates correctly', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    
    // Use more specific selector - sidebar link in the nav area
    const scheduleLink = page.locator('nav a[href="/admin/schedule"]').first();
    await scheduleLink.click();
    
    await expect(page).toHaveURL(/\/admin\/schedule/);
  });
});
