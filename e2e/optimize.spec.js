// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Diagnostics Strategy Layer', () => {
  test('strategy tab exposes the AI report entry point', async ({ page }) => {
    await page.goto('/diagnostics');

    const drawer = page.locator('[data-testid="evidence-drawer"]');
    await drawer.getByRole('button', { name: 'Strategy' }).click();

    await expect(drawer.getByText('AI Optimization Report', { exact: true })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Generate AI Report' })).toBeVisible();
    await expect(drawer.getByText('Click "Generate AI Report" for additional strategy suggestions')).toBeVisible();
  });
});
