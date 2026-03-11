// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Diagnostics Workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/diagnostics');
  });

  test('renders summary cards and workbench layout', async ({ page }) => {
    await expect(page.locator('h1:text("Diagnostics")')).toBeVisible();
    await expect(page.getByText('Rules Triggered', { exact: true })).toBeVisible();
    await expect(page.getByText('Affected sessions').first()).toBeVisible();
    await expect(page.getByText('Recoverable waste', { exact: true })).toBeVisible();
    await expect(page.getByText('Issue queue', { exact: true })).toBeVisible();
    await expect(page.locator('[data-testid="issue-queue"]')).toBeVisible();
    await expect(page.locator('[data-testid="evidence-drawer"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Evidence' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Strategy' })).toBeVisible();
  });

  test('switches selected issue and updates the evidence drawer', async ({ page }) => {
    const queue = page.locator('[data-testid="issue-queue"]');
    const drawer = page.locator('[data-testid="evidence-drawer"]');

    await expect(drawer).toContainText('Context keeps growing');
    await queue.getByRole('button', { name: /Tool calls are looping/i }).click();
    await expect(drawer).toContainText('Tool calls are looping');
    await expect(drawer.getByText('No session data available', { exact: true })).toBeVisible();
  });

  test('shows actionable steps in the actions tab', async ({ page }) => {
    const drawer = page.locator('[data-testid="evidence-drawer"]');

    await page.getByRole('button', { name: /Output is too long/i }).click();
    await drawer.getByRole('button', { name: 'Actions' }).click();

    await expect(drawer.getByText('Next actions', { exact: true })).toBeVisible();
    await expect(drawer.getByText('Ask for a conclusion first and details only on demand.')).toBeVisible();
  });
});
