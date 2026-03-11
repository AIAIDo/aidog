// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
  });

  test('displays AI Provider section', async ({ page }) => {
    await expect(page.locator('text=AI Provider')).toBeVisible();
    await expect(page.locator('text=Providers')).toBeVisible();
  });

  test('displays discovered providers', async ({ page }) => {
    await expect(page.locator('span:text("Anthropic")').first()).toBeVisible();
    await expect(page.locator('span:text("Ollama")')).toBeVisible();
  });

  test('shows provider availability status', async ({ page }) => {
    await expect(page.locator('text=Available').first()).toBeVisible();
  });

  test('displays provider count', async ({ page }) => {
    await expect(page.locator('text=/\\d+ provider/')).toBeVisible();
  });

  test('displays Alerts section with slider', async ({ page }) => {
    await expect(page.locator('text=Alerts')).toBeVisible();
    await expect(page.locator('text=Health Score Threshold')).toBeVisible();
    await expect(page.locator('input[type="range"]')).toBeVisible();
  });

  test('displays Analysis section', async ({ page }) => {
    await expect(page.locator('text=Analysis').first()).toBeVisible();
    await expect(page.locator('text=Analysis Interval')).toBeVisible();
    await expect(page.locator('text=Auto-Analyze')).toBeVisible();
    await expect(page.locator('text=Max Session Age')).toBeVisible();
  });

  test('displays Storage section', async ({ page }) => {
    await expect(page.locator('text=Storage')).toBeVisible();
    await expect(page.locator('text=Data Path')).toBeVisible();
  });

  test('displays Save button', async ({ page }) => {
    await expect(page.locator('button:text("Save Settings")')).toBeVisible();
  });

  test('save button triggers save action', async ({ page }) => {
    await page.locator('button:text("Save Settings")').click();
    // Should show success message
    await expect(page.locator('text=Settings saved')).toBeVisible({ timeout: 5000 });
  });

  test('provider selection dropdown works', async ({ page }) => {
    const providerSelect = page.locator('select').filter({ has: page.locator('option:text("Auto-detect")') });
    await expect(providerSelect).toBeVisible();
    await providerSelect.selectOption('anthropic');
    // Verify selection changed
    await expect(providerSelect).toHaveValue('anthropic');
  });

  test('analysis interval dropdown works', async ({ page }) => {
    const intervalSelect = page.locator('select').filter({ has: page.locator('option:text("5 minutes")') });
    await expect(intervalSelect).toBeVisible();
    await intervalSelect.selectOption('600');
    await expect(intervalSelect).toHaveValue('600');
  });

  test('clicking provider card expands config', async ({ page }) => {
    // Click on Anthropic provider card
    await page.locator('text=Anthropic').first().click();
    // Should show configuration panel
    await expect(page.locator('text=Anthropic Configuration')).toBeVisible();
    await expect(page.locator('text=API Key')).toBeVisible();
    await expect(page.locator('text=Custom Model')).toBeVisible();
  });

  test('model preset buttons are visible when provider expanded', async ({ page }) => {
    await page.locator('text=Anthropic').first().click();
    await expect(page.locator('button:text("claude-sonnet-4-20250514")').first()).toBeVisible();
  });

  test('auto-analyze toggle works', async ({ page }) => {
    // Find the toggle button near Auto-Analyze
    const toggleSection = page.locator('text=Auto-Analyze').locator('..').locator('..');
    const toggleBtn = toggleSection.locator('button').filter({ has: page.locator('span.rounded-full') });
    await expect(toggleBtn).toBeVisible();
    // Click the toggle
    await toggleBtn.click();
    // Toggle should change state (bg color class changes)
  });
});
