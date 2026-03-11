// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Plugins Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/plugins');
  });

  test('displays summary cards', async ({ page }) => {
    await expect(page.locator('text=Total Plugins')).toBeVisible();
    await expect(page.locator('.card.text-center:has-text("Available")')).toBeVisible();
    await expect(page.locator('.card.text-center:has-text("Enabled")')).toBeVisible();
  });

  test('displays plugin cards', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Claude Code' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Codex CLI' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Custom Plugin' })).toBeVisible();
  });

  test('plugin cards show descriptions', async ({ page }) => {
    await expect(page.locator('text=Parse Claude Code JSONL logs')).toBeVisible();
    await expect(page.locator('text=Parse Codex CLI logs')).toBeVisible();
  });

  test('plugin cards show availability badges', async ({ page }) => {
    // Multiple "Available" badges for available plugins
    const availableBadges = page.locator('.badge:text("Available")');
    await expect(availableBadges.first()).toBeVisible();
  });

  test('plugin cards show enabled/disabled badges', async ({ page }) => {
    await expect(page.locator('.badge:text("Enabled")').first()).toBeVisible();
    await expect(page.locator('.badge:text("Disabled")').first()).toBeVisible();
  });

  test('plugin toggle buttons are visible', async ({ page }) => {
    // Toggle buttons (rounded-full switch style)
    const toggles = page.locator('button:has(span.rounded-full)');
    await expect(toggles.first()).toBeVisible();
  });

  test('unavailable plugin has reduced opacity', async ({ page }) => {
    // Custom Plugin is unavailable (available: false)
    const customPlugin = page.locator('.card-hover.opacity-50');
    await expect(customPlugin).toBeVisible();
    await expect(customPlugin).toContainText('Custom Plugin');
  });

  test('plugin card shows version', async ({ page }) => {
    await expect(page.locator('text=v1.0.0').first()).toBeVisible();
  });

  test('plugin card shows author', async ({ page }) => {
    await expect(page.locator('text=By aidog').first()).toBeVisible();
  });

  test('summary counts are correct', async ({ page }) => {
    // 3 total, 2 available, 1 enabled (from mock)
    const cards = page.locator('.card.text-center');
    await expect(cards.nth(0)).toContainText('3');
    await expect(cards.nth(1)).toContainText('2');
    await expect(cards.nth(2)).toContainText('1');
  });
});
