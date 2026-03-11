import { Router } from 'express';

const router = Router();

/**
 * GET /api/rules
 * List all rules (built-in + custom).
 * Query params: type=token|security
 */
router.get('/', (req, res) => {
  try {
    const ruleManager = req.app.get('ruleManager');
    if (!ruleManager) {
      return res.status(500).json({ error: 'Rule manager not initialized' });
    }
    const type = req.query.type || undefined;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));
    const result = ruleManager.listAllRules(type);

    const total = result.rules.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const offset = (page - 1) * pageSize;

    res.json({
      rules: result.rules.slice(offset, offset + pageSize),
      counts: result.counts,
      pagination: { page, pageSize, total, totalPages },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/rules/:id
 * Get a single rule by ID.
 */
router.get('/:id', (req, res) => {
  try {
    const ruleManager = req.app.get('ruleManager');
    const rule = ruleManager.getRule(req.params.id, req.query.type);
    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/rules/:id
 * Update a built-in rule override.
 */
router.put('/:id', (req, res) => {
  try {
    const ruleManager = req.app.get('ruleManager');
    const { type, ...updates } = req.body || {};
    if (!type || !['token', 'security'].includes(type)) {
      return res.status(400).json({ error: 'type must be "token" or "security"' });
    }
    const success = ruleManager.updateBuiltInRule(req.params.id, type, updates);
    if (!success) return res.status(404).json({ error: 'Built-in rule not found or not editable' });
    res.json({ ok: true, ruleId: req.params.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/rules/:id/override
 * Restore a built-in rule to defaults.
 */
router.delete('/:id/override', (req, res) => {
  try {
    const ruleManager = req.app.get('ruleManager');
    const type = req.query.type || req.body?.type;
    if (!type || !['token', 'security'].includes(type)) {
      return res.status(400).json({ error: 'type must be "token" or "security"' });
    }
    const success = ruleManager.restoreBuiltInRule(req.params.id, type);
    if (!success) return res.status(404).json({ error: 'Built-in rule not found or not restorable' });
    res.json({ ok: true, ruleId: req.params.id, restored: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /api/rules/:id/toggle
 * Enable/disable a rule.
 * Body: { enabled: boolean, type: 'token' | 'security' }
 */
router.put('/:id/toggle', (req, res) => {
  try {
    const ruleManager = req.app.get('ruleManager');
    const { enabled, type } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    if (!type || !['token', 'security'].includes(type)) {
      return res.status(400).json({ error: 'type must be "token" or "security"' });
    }
    ruleManager.toggleRule(req.params.id, type, enabled);
    res.json({ ok: true, ruleId: req.params.id, enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/rules/custom
 * Create a custom rule.
 * Body: { ruleType, name, severity, description?, definition }
 */
router.post('/custom', (req, res) => {
  try {
    const ruleManager = req.app.get('ruleManager');
    const id = ruleManager.createCustomRule(req.body);
    res.status(201).json({ ok: true, id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /api/rules/custom/:id
 * Update a custom rule.
 */
router.put('/custom/:id', (req, res) => {
  try {
    const ruleManager = req.app.get('ruleManager');
    const success = ruleManager.updateCustomRule(req.params.id, req.body);
    if (!success) return res.status(404).json({ error: 'Custom rule not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/rules/custom/:id
 * Delete a custom rule.
 */
router.delete('/custom/:id', (req, res) => {
  try {
    const ruleManager = req.app.get('ruleManager');
    const success = ruleManager.deleteCustomRule(req.params.id);
    if (!success) return res.status(404).json({ error: 'Custom rule not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
