// @ts-check
import { test, expect } from '@playwright/test';

test.describe('API Integration Tests', () => {
  test('GET /api/stats returns valid data', async ({ request }) => {
    const res = await request.get('/api/stats?days=7');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.totalTokens).toBeGreaterThan(0);
    expect(data.daily).toHaveLength(7);
    expect(data.healthScore).toBeDefined();
    expect(data.healthScore.score).toBe(72);
    expect(data.healthScore.breakdown).toBeDefined();
  });

  test('GET /api/sessions returns session list', async ({ request }) => {
    const res = await request.get('/api/sessions?limit=10');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.total).toBeGreaterThan(0);
    expect(data.sessions).toBeInstanceOf(Array);
    expect(data.sessions[0].sessionId).toBeDefined();
    expect(data.sessions[0].agent).toBeDefined();
  });

  test('GET /api/sessions with search filters results', async ({ request }) => {
    const res = await request.get('/api/sessions?search=nonexistent');
    const data = await res.json();
    expect(data.total).toBe(0);
    expect(data.sessions).toHaveLength(0);
  });

  test('GET /api/sessions/:id returns session detail', async ({ request }) => {
    const res = await request.get('/api/sessions/test-session-1');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.sessionId).toBe('test-session-1');
    expect(data.agent).toBeDefined();
    expect(data.totalInput).toBeDefined();
    expect(data.totalOutput).toBeDefined();
  });

  test('GET /api/sessions/:id returns 404 for unknown', async ({ request }) => {
    const res = await request.get('/api/sessions/unknown-id');
    expect(res.status()).toBe(404);
  });

  test('GET /api/sessions/:id/messages returns paginated messages', async ({ request }) => {
    const res = await request.get('/api/sessions/test-session-1/messages?page=1&pageSize=20');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.messages).toBeInstanceOf(Array);
    expect(data.pagination).toBeDefined();
    expect(data.pagination.page).toBe(1);
  });

  test('GET /api/analysis returns analysis data', async ({ request }) => {
    const res = await request.get('/api/analysis?days=7');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.healthScore).toBeDefined();
    expect(data.totalWastedTokens).toBeGreaterThan(0);
    expect(data.summary).toBeInstanceOf(Array);
  });

  test('GET /api/rules returns token rules', async ({ request }) => {
    const res = await request.get('/api/rules?type=token');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.rules).toBeInstanceOf(Array);
    expect(data.rules.length).toBeGreaterThan(0);
    expect(data.rules[0].ruleId).toBeDefined();
  });

  test('GET /api/rules returns security rules', async ({ request }) => {
    const res = await request.get('/api/rules?type=security');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.rules).toBeInstanceOf(Array);
    expect(data.rules.length).toBeGreaterThan(0);
  });

  test('PUT /api/rules/:id/toggle works', async ({ request }) => {
    const res = await request.put('/api/rules/R1/toggle', {
      data: { enabled: false, type: 'token' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test('POST /api/rules/custom creates rule', async ({ request }) => {
    const res = await request.post('/api/rules/custom', {
      data: { ruleType: 'token', name: 'Test Rule', severity: 'medium', definition: {} },
    });
    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.id).toBeDefined();
  });

  test('GET /api/plugins returns plugin list', async ({ request }) => {
    const res = await request.get('/api/plugins');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.plugins).toBeInstanceOf(Array);
    expect(data.plugins.length).toBe(3);
  });

  test('GET /api/config/discover returns providers', async ({ request }) => {
    const res = await request.get('/api/config/discover');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.providers).toBeInstanceOf(Array);
    expect(data.recommended).toBe('anthropic');
  });

  test('GET /api/settings returns settings', async ({ request }) => {
    const res = await request.get('/api/settings');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.aiProvider).toBeDefined();
    expect(data.alertThreshold).toBeDefined();
  });

  test('PUT /api/settings saves settings', async ({ request }) => {
    const res = await request.put('/api/settings', {
      data: { aiProvider: 'anthropic', alertThreshold: 70 },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('POST /api/security/scan/trigger returns scan result', async ({ request }) => {
    const res = await request.post('/api/security/scan/trigger', {
      data: { type: 'full' },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.status).toBe('completed');
    expect(data.scanId).toBeDefined();
    expect(data.securityScore).toBeDefined();
  });

  test('GET /api/security/scan/latest returns latest scan', async ({ request }) => {
    const res = await request.get('/api/security/scan/latest');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.scan).toBeDefined();
    expect(data.findings).toBeInstanceOf(Array);
  });

  test('GET /api/security/findings returns findings', async ({ request }) => {
    const res = await request.get('/api/security/findings');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.findings).toBeInstanceOf(Array);
    expect(data.pagination).toBeDefined();
  });

  test('GET /api/security/history returns history', async ({ request }) => {
    const res = await request.get('/api/security/history?days=30');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.trend).toBeDefined();
    expect(data.trendData).toBeDefined();
  });

  test('404 for unknown API endpoint', async ({ request }) => {
    const res = await request.get('/api/nonexistent');
    expect(res.status()).toBe(404);
  });
});
