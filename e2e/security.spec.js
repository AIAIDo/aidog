// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Security Overview Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/security');
  });

  test('displays page title and scan button', async ({ page }) => {
    await expect(page.locator('text=安全扫描概览')).toBeVisible();
    await expect(page.locator('button:text("重新扫描")')).toBeVisible();
  });

  test('trigger scan shows results', async ({ page }) => {
    await page.locator('button:text("重新扫描")').click();
    // Button changes to loading state
    await expect(page.locator('button:text("扫描中...")')).toBeVisible();
    // Wait for scan result to appear
    await expect(page.locator('text=扫描文件')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=扫描行数')).toBeVisible();
    await expect(page.locator('text=泄漏发现')).toBeVisible();
    await expect(page.locator('text=暴露风险')).toBeVisible();
  });

  test('scan results show security score', async ({ page }) => {
    await page.locator('button:text("重新扫描")').click();
    // Score should be visible (85 from mock)
    await expect(page.locator('text=85')).toBeVisible({ timeout: 10000 });
  });

  test('scan results show stat card values', async ({ page }) => {
    await page.locator('button:text("重新扫描")').click();
    // From mock: 128 files, 15420 lines, 2 findings
    await expect(page.locator('text=128')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Security Exposure Page', () => {
  test('loads exposure page', async ({ page }) => {
    await page.goto('/security/exposure');
    await expect(page.locator('h1:text("暴露检测")')).toBeVisible();
  });
});

test.describe('Security Leakage Page', () => {
  test('loads leakage page', async ({ page }) => {
    await page.goto('/security/leakage');
    await expect(page.locator('h1:text("泄露扫描")')).toBeVisible();
  });
});

test.describe('Security Rules Page', () => {
  test('loads security rules page', async ({ page }) => {
    await page.goto('/security/rules');
    await expect(page.locator('h1:text("检测规则")')).toBeVisible();
  });
});
