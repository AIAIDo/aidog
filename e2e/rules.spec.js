// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Token Rules Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/token-rules');
  });

  test('displays page title and advanced config entry point', async ({ page }) => {
    await expect(page.locator('text=Token Analysis Rules')).toBeVisible();
    await expect(page.locator('text=How the system detects token waste patterns')).toBeVisible();
    await expect(page.locator('button:text("Show advanced configuration")')).toBeVisible();
  });

  test('displays rule summary info', async ({ page }) => {
    await expect(page.locator('text=/\\d+ rules total/')).toBeVisible();
  });

  test('displays grouped rule library cards', async ({ page }) => {
    await expect(page.getByText('Rule groups', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Session structure' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Context keeps growing' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tool calls are looping' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Output is too long' })).toBeVisible();
  });

  test('advanced config reveals add custom rule form', async ({ page }) => {
    await page.locator('button:text("Show advanced configuration")').click();
    await expect(page.getByRole('heading', { name: 'Advanced configuration' })).toBeVisible();
    await page.locator('button:text("Add Custom Rule")').click();
    await expect(page.locator('text=Add Custom Token Analysis Rule')).toBeVisible();
    // Form fields visible
    await expect(page.locator('label:text("Name")')).toBeVisible();
    await expect(page.locator('label:text("Severity")')).toBeVisible();
    await expect(page.locator('label:text("Description")')).toBeVisible();
    await expect(page.locator('label:text("Metric Field")')).toBeVisible();
    await expect(page.locator('label:text("Threshold")')).toBeVisible();
  });

  test('cancel button closes form', async ({ page }) => {
    await page.locator('button:text("Show advanced configuration")').click();
    await page.locator('button:text("Add Custom Rule")').click();
    await expect(page.locator('text=Add Custom Token Analysis Rule')).toBeVisible();
    await page.locator('button:text("Cancel")').click();
    await expect(page.locator('text=Add Custom Token Analysis Rule')).not.toBeVisible();
  });

  test('fill and submit custom rule form', async ({ page }) => {
    await page.locator('button:text("Show advanced configuration")').click();
    await page.locator('button:text("Add Custom Rule")').click();

    // Fill form
    await page.locator('label:text("Name")').locator('..').locator('input').fill('Test Custom Rule');
    await page.locator('label:text("Description")').locator('..').locator('input').fill('A test rule for e2e');
    await page.locator('label:text("Threshold")').locator('..').locator('input').fill('50000');

    // Submit
    await page.locator('button:text("Save")').click();

    // Form should close on success
    await expect(page.locator('text=Add Custom Token Analysis Rule')).not.toBeVisible({ timeout: 5000 });
  });
});
