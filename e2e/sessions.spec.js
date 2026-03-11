// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Sessions Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sessions');
  });

  test('displays session list in left panel', async ({ page }) => {
    // Wait for sessions to load
    await expect(page.locator('text=test-session').first()).toBeVisible();
    // Should show session count
    await expect(page.locator('text=/\\d+ sessions?/')).toBeVisible();
  });

  test('displays search input and Go button', async ({ page }) => {
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
    await expect(page.locator('button:text("Go")')).toBeVisible();
  });

  test('displays agent filter dropdown', async ({ page }) => {
    const select = page.locator('select:has(option:text("All agents"))');
    await expect(select).toBeVisible();
  });

  test('displays sort buttons', async ({ page }) => {
    await expect(page.locator('button:text("Time")')).toBeVisible();
    await expect(page.locator('button:text("Size")')).toBeVisible();
  });

  test('right panel shows placeholder when no session selected', async ({ page }) => {
    await expect(page.locator('text=Select a session to view messages')).toBeVisible();
  });

  test('clicking a session shows detail panel', async ({ page }) => {
    // Click first session
    await page.locator('text=test-session').first().click();
    // Detail panel should show session ID
    await expect(page.locator('.font-mono.text-primary-400').first()).toBeVisible();
    // Stats row should be visible
    await expect(page.locator('text=Input:')).toBeVisible();
    await expect(page.locator('text=Output:')).toBeVisible();
  });

  test('search filters sessions', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('nonexistent');
    await page.locator('button:text("Go")').click();
    // Should show no results
    await expect(page.locator('text=No sessions found')).toBeVisible();
  });

  test('search with matching term shows results', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('test-session');
    await page.locator('button:text("Go")').click();
    await expect(page.locator('text=test-session').first()).toBeVisible();
  });

  test('clear button resets search and filter', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('something');
    await page.locator('button:text("Go")').click();
    // Clear button should appear
    const clearBtn = page.locator('button:text("Clear")');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();
    // Search input should be cleared
    await expect(searchInput).toHaveValue('');
  });

  test('sort toggle changes sort direction', async ({ page }) => {
    const timeBtn = page.locator('button:has-text("Time")');
    await timeBtn.click();
    // Should show ascending indicator after click (was desc by default)
    await expect(timeBtn).toContainText('▲');
  });

  test('session detail shows token breakdown', async ({ page }) => {
    // Click first session
    await page.locator('text=test-session').first().click();
    await expect(page.locator('text=Cache R:')).toBeVisible();
    await expect(page.locator('text=Cache W:')).toBeVisible();
    await expect(page.locator('text=Events:')).toBeVisible();
    await expect(page.locator('text=Duration:')).toBeVisible();
  });

  test('deep link via query param selects session', async ({ page }) => {
    await page.goto('/sessions?id=test-session-1');
    // Should auto-select the session and show detail
    await expect(page.locator('text=test-session-1')).toBeVisible();
  });
});
