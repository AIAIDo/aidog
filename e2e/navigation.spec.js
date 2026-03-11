// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Navigation & Layout', () => {
  test('should load the home page with sidebar and header', async ({ page }) => {
    await page.goto('/');
    // Sidebar visible with logo
    await expect(page.locator('aside').getByText('aidog', { exact: true })).toBeVisible();
    // Page title in header
    await expect(page.locator('h1:text("Overview")')).toBeVisible();
  });

  test('sidebar contains all navigation items', async ({ page }) => {
    await page.goto('/');
    const navItems = ['Overview', 'Sessions', 'Diagnostics', 'Rule Library', 'Plugins', 'Settings'];
    for (const item of navItems) {
      await expect(page.locator(`nav >> text="${item}"`)).toBeVisible();
    }
  });

  test('sidebar contains security section items', async ({ page }) => {
    await page.goto('/');
    const secItems = ['Scan Overview', 'Exposure Detection', 'Leakage Scan', 'Detection Rules'];
    for (const item of secItems) {
      await expect(page.locator(`nav >> text="${item}"`)).toBeVisible();
    }
  });

  test('navigate to Sessions page', async ({ page }) => {
    await page.goto('/');
    await page.click('nav >> text="Sessions"');
    await expect(page).toHaveURL(/\/sessions/);
    await expect(page.locator('h1:text("Sessions")')).toBeVisible();
  });

  test('navigate to Analysis page', async ({ page }) => {
    await page.goto('/');
    await page.click('nav >> text="Diagnostics"');
    await expect(page).toHaveURL(/\/diagnostics/);
    await expect(page.locator('h1:text("Diagnostics")')).toBeVisible();
  });

  test('direct diagnostics route works', async ({ page }) => {
    await page.goto('/diagnostics');
    await expect(page).toHaveURL(/\/diagnostics/);
    await expect(page.locator('h1:text("Diagnostics")')).toBeVisible();
  });

  test('navigate to Settings page', async ({ page }) => {
    await page.goto('/');
    await page.click('nav >> text="Settings"');
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('h1:text("Settings")')).toBeVisible();
  });

  test('navigate to Plugins page', async ({ page }) => {
    await page.goto('/');
    await page.click('nav >> text="Plugins"');
    await expect(page).toHaveURL(/\/plugins/);
    await expect(page.locator('h1:text("Plugins")')).toBeVisible();
  });

  test('navigate to Security Overview page', async ({ page }) => {
    await page.goto('/');
    await page.click('nav >> text="Scan Overview"');
    await expect(page).toHaveURL(/\/security$/);
    await expect(page.locator('h1:text("Scan Overview")')).toBeVisible();
  });

  test('navigate to Token Rules page', async ({ page }) => {
    await page.goto('/');
    await page.click('nav >> text="Rule Library"');
    await expect(page).toHaveURL(/\/token-rules/);
    await expect(page.locator('h1:text("Rule Library")')).toBeVisible();
  });

  test('sidebar toggle collapses and expands', async ({ page }) => {
    await page.goto('/');
    const sidebar = page.locator('aside');
    // Initially expanded (w-56)
    await expect(sidebar).toHaveClass(/w-56/);

    // Click toggle button
    await page.click('button[aria-label="Toggle sidebar"]');
    await expect(sidebar).toHaveClass(/w-16/);

    // Click again to expand
    await page.click('button[aria-label="Toggle sidebar"]');
    await expect(sidebar).toHaveClass(/w-56/);
  });

  test('direct URL navigation works (SPA routing)', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1:text("Settings")')).toBeVisible();

    await page.goto('/diagnostics');
    await expect(page.locator('h1:text("Diagnostics")')).toBeVisible();

    await page.goto('/sessions');
    await expect(page.locator('h1:text("Sessions")')).toBeVisible();

    await page.goto('/security');
    await expect(page.locator('h1:text("Scan Overview")')).toBeVisible();
  });
});
