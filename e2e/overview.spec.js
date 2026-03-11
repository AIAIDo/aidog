// @ts-check
import { test, expect } from '@playwright/test';

test.describe('Overview Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('displays page title and refresh button', async ({ page }) => {
    await expect(page.locator('text=Token 分析概览')).toBeVisible();
    await expect(page.locator('button:text("刷新分析")')).toBeVisible();
  });

  test('displays stat cards with data', async ({ page }) => {
    await expect(page.locator('text=会话数')).toBeVisible();
    await expect(page.getByText('Token 消耗', { exact: true })).toBeVisible();
    await expect(page.locator('text=平均评分')).toBeVisible();
    await expect(page.locator('text=预估浪费')).toBeVisible();
  });

  test('displays health score gauge', async ({ page }) => {
    // Score value should be visible (72 from mock)
    await expect(page.locator('text=72').first()).toBeVisible();
  });

  test('displays breakdown bars', async ({ page }) => {
    await expect(page.locator('text=浪费控制')).toBeVisible();
    await expect(page.locator('text=缓存效率')).toBeVisible();
    await expect(page.locator('text=会话质量')).toBeVisible();
    await expect(page.locator('text=模型匹配')).toBeVisible();
    await expect(page.locator('text=工具效率')).toBeVisible();
  });

  test('displays trend chart section', async ({ page }) => {
    await expect(page.locator('text=Token 消耗趋势')).toBeVisible();
    await expect(page.locator('text=最近 7 天')).toBeVisible();
  });

  test('displays model distribution section', async ({ page }) => {
    await expect(page.locator('text=模型分布')).toBeVisible();
  });

  test('displays bottom sections', async ({ page }) => {
    await expect(page.locator('text=当前会话')).toBeVisible();
    await expect(page.locator('text=最近会话')).toBeVisible();
    await expect(page.locator('text=Top 浪费模式')).toBeVisible();
  });

  test('displays readable waste pattern copy', async ({ page }) => {
    await expect(page.getByText('工具调用在兜圈子', { exact: true })).toBeVisible();
    await expect(page.getByText('Agent 连续重复调用相似工具，但没有产生有效进展。', { exact: true })).toBeVisible();
  });

  test('displays live session status', async ({ page }) => {
    // No active session in mock
    await expect(page.locator('text=无活跃会话')).toBeVisible();
  });

  test('displays recent sessions list', async ({ page }) => {
    // Mock has sessions with agent names
    await expect(page.locator('text=claude-code').first()).toBeVisible();
  });

  test('recent session entry opens the matching session', async ({ page }) => {
    await page.getByText('project-1', { exact: true }).click();
    await expect(page).toHaveURL(/\/sessions\?id=test-session-1/);
  });

  test('waste pattern opens diagnostics with matching rule', async ({ page }) => {
    await page.getByText('工具调用在兜圈子', { exact: true }).click();
    await expect(page).toHaveURL(/\/analysis\?rule=R2/);
    await expect(page.getByText('工具调用在兜圈子', { exact: true })).toBeVisible();
  });

  test('refresh button triggers reload', async ({ page }) => {
    const refreshBtn = page.locator('button:text("刷新分析")');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    // Mock API responds quickly, just verify button returns to normal state
    await expect(refreshBtn).toBeVisible({ timeout: 5000 });
  });
});
