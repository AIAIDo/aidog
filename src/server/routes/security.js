import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { SecurityEngine } from '../../security/index.js';
import { countryDefaults, countryList } from '../../security/leakage/rules/country-defaults.js';
import { localhostOnly } from '../middleware/localhost-only.js';

const router = Router();

// Rate limiting state
let lastScanTime = 0;
const MIN_SCAN_INTERVAL = 30_000; // 30 seconds

/**
 * POST /api/security/scan/trigger
 * Trigger a security scan.
 */
router.post('/scan/trigger', localhostOnly, async (req, res) => {
  const now = Date.now();
  if (now - lastScanTime < MIN_SCAN_INTERVAL) {
    return res.status(429).json({
      error: 'Scan rate limited',
      retryAfterMs: MIN_SCAN_INTERVAL - (now - lastScanTime),
    });
  }
  lastScanTime = now;

  try {
    const securityEngine = req.app.get('securityEngine');
    if (!securityEngine) {
      return res.status(500).json({ error: 'Security engine not initialized' });
    }

    const { type = 'full', since, ruleIds, ports } = req.body || {};
    const options = { triggerSource: 'api' };
    if (since) options.since = new Date(since);
    if (ruleIds) options.ruleIds = ruleIds;
    if (ports) options.ports = ports;

    // Fetch score history for trend computation
    const storage = req.app.get('storage');
    const scoreHistory = storage ? storage.getScoreTimeline(30, type) : [];
    const scoreOpts = { scoreHistory };

    let result;
    if (type === 'exposure') {
      const exposure = await securityEngine.scanExposure(options);
      result = {
        scanId: `sec_${uuidv4().slice(0, 12)}`,
        scannedAt: Date.now(),
        exposure,
        securityScore: securityEngine.calculateSecurityScore(null, exposure, scoreOpts),
      };
    } else if (type === 'leakage') {
      const leakage = await securityEngine.scanLeakage(options);
      result = {
        scanId: `sec_${uuidv4().slice(0, 12)}`,
        scannedAt: Date.now(),
        leakage,
        securityScore: securityEngine.calculateSecurityScore(leakage, null, scoreOpts),
      };
    } else {
      // For full scan, pass scoreHistory through options
      const fullResult = await securityEngine.scan(options);
      fullResult.securityScore = securityEngine.calculateSecurityScore(
        fullResult.leakage, fullResult.exposure, scoreOpts
      );
      result = fullResult;
    }

    // Save to storage before computing trend so the current scan participates
    // in the returned sparkline/delta.
    if (storage) {
      const findings = [];
      if (result.leakage?.findings) {
        for (const f of result.leakage.findings) {
          findings.push({ ...f, category: 'leakage' });
        }
      }
      if (result.exposure?.portFindings) {
        for (const f of result.exposure.portFindings) {
          findings.push({
            category: 'exposure',
            ruleId: 'port_exposure',
            ruleName: '端口暴露',
            severity: f.severity || 'high',
            port: f.port,
            service: f.service,
            publicIp: f.publicIp,
            reachable: f.reachable,
          });
        }
      }
      if (result.exposure?.localBindingFindings) {
        for (const f of result.exposure.localBindingFindings) {
          findings.push({
            category: 'exposure',
            ruleId: 'local_binding',
            ruleName: f.ruleName || '本地全接口监听',
            severity: f.severity || 'high',
            port: f.port,
            service: f.service,
            bindAddress: f.bindAddress,
            pid: f.pid,
            process: f.process,
            remediation: f.remediation,
          });
        }
      }
      if (result.exposure?.tunnelFindings) {
        for (const f of result.exposure.tunnelFindings) {
          findings.push({
            category: 'exposure',
            ruleId: 'tunnel_detected',
            ruleName: '穿透工具',
            severity: 'high',
            tunnelTool: f.tool,
            tunnelPid: f.pid,
            tunnelCommand: f.command,
          });
        }
      }

      storage.saveSecurityScan({
        scanId: result.scanId,
        scanType: type,
        triggerSource: 'api',
        scannedAt: result.scannedAt,
        publicIp: result.exposure?.publicIp || null,
        filesScanned: result.leakage?.filesScanned || 0,
        linesScanned: result.leakage?.linesScanned || 0,
        totalFindings: findings.length,
        securityScore: result.securityScore,
        findings,
      });

      if (result.securityScore) {
        result.securityScore.trend = SecurityEngine.computeTrend(storage.getScoreTimeline(30, type));
      }
    }

    res.json({ status: 'completed', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/security/scan/latest
 */
router.get('/scan/latest', (req, res) => {
  try {
    const storage = req.app.get('storage');
    const scanType = req.query.type;
    const scan = storage.getLatestSecurityScan(scanType || undefined);
    if (!scan) {
      return res.status(404).json({ error: 'No security scan found' });
    }
    const { findings } = storage.getSecurityFindings(scan.id);

    // Attach trend data
    if (scan.securityScore) {
      const timeline = storage.getScoreTimeline(30, scan.scanType);
      scan.securityScore.trend = SecurityEngine.computeTrend(timeline);
    }

    res.json({ scan, findings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/security/findings
 */
router.get('/findings', (req, res) => {
  try {
    const storage = req.app.get('storage');
    const {
      scanId,
      scanType,
      category,
      severity,
      ruleId,
      page = '1',
      pageSize = '50',
    } = req.query;

    // If no scanId, use latest scan
    let targetScanId = scanId;
    if (!targetScanId) {
      const latest = storage.getLatestSecurityScan(scanType || undefined);
      if (!latest) {
        return res.json({ findings: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } });
      }
      targetScanId = latest.id;
    }

    const result = storage.getSecurityFindings(targetScanId, {
      category,
      severity,
      ruleId,
      page: parseInt(page, 10),
      pageSize: Math.min(parseInt(pageSize, 10), 200),
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/security/rules
 */
router.get('/rules', (req, res) => {
  try {
    const securityEngine = req.app.get('securityEngine');
    if (!securityEngine) {
      return res.status(500).json({ error: 'Security engine not initialized' });
    }
    const { builtIn, custom } = securityEngine.listRules();
    const rules = [
      ...builtIn.map(r => ({ ...r, builtIn: true, category: 'leakage' })),
      ...custom.map(r => ({ ...r, builtIn: false, category: 'leakage' })),
    ];
    res.json({ rules, totalBuiltIn: builtIn.length, totalCustom: custom.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/security/history
 */
router.get('/history', (req, res) => {
  try {
    const storage = req.app.get('storage');
    const days = parseInt(req.query.days || '30', 10);
    const scanType = req.query.type;
    const history = storage.getSecurityHistory(days, scanType || undefined);
    const timeline = storage.getScoreTimeline(days, scanType || undefined);
    const trendData = SecurityEngine.computeTrend(timeline);

    res.json({ history, trend: trendData.direction, trendData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/security/country-defaults
 * Returns available countries and their default phone/ID patterns.
 */
router.get('/country-defaults', (req, res) => {
  const countries = countryList.map(({ code, label }) => ({
    code,
    label,
    phone: countryDefaults[code].phone,
    idCard: countryDefaults[code].idCard,
  }));
  res.json({ countries });
});

export default router;
