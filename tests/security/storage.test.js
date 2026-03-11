import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorage } from '../../src/storage/sqlite.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Security Storage', () => {
  let storage;
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aidog-security-test-'));
    const dbPath = join(tmpDir, 'test.db');
    storage = new SQLiteStorage(dbPath);
  });

  afterEach(() => {
    if (storage) storage.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('saveSecurityScan', () => {
    it('should save a scan with findings', () => {
      const scanId = storage.saveSecurityScan({
        scanId: 'sec_test001',
        scanType: 'full',
        triggerSource: 'cli',
        scannedAt: Date.now(),
        publicIp: '203.0.113.42',
        filesScanned: 5,
        linesScanned: 1000,
        totalFindings: 2,
        securityScore: { score: 85, grade: 'B', label: 'Caution', breakdown: { leakage: 42, exposure: 43 } },
        findings: [
          { ruleId: 'S1', ruleName: '手机号', severity: 'medium', category: 'leakage', filePath: '/test/file.jsonl', lineNumber: 42, maskedSnippet: '138****5678' },
          { ruleId: 'S7', ruleName: 'API Key', severity: 'high', category: 'leakage', filePath: '/test/file.jsonl', lineNumber: 100, maskedSnippet: 'sk-a...ghij' },
        ],
      });

      expect(scanId).toBe('sec_test001');
    });

    it('should save scan without findings', () => {
      const scanId = storage.saveSecurityScan({
        scanId: 'sec_test002',
        scanType: 'exposure',
        scannedAt: Date.now(),
        totalFindings: 0,
        securityScore: { score: 100, grade: 'A', label: 'Safe' },
      });

      expect(scanId).toBe('sec_test002');
    });
  });

  describe('getLatestSecurityScan', () => {
    it('should return the most recent scan', async () => {
      storage.saveSecurityScan({ scanId: 'sec_old', scanType: 'full', scannedAt: Date.now() - 10000, totalFindings: 0 });
      // Ensure different created_at timestamp
      await new Promise(r => setTimeout(r, 10));
      storage.saveSecurityScan({ scanId: 'sec_new', scanType: 'full', scannedAt: Date.now(), totalFindings: 1 });

      const latest = storage.getLatestSecurityScan();
      expect(latest.id).toBe('sec_new');
    });

    it('should filter by type', () => {
      storage.saveSecurityScan({ scanId: 'sec_full', scanType: 'full', scannedAt: Date.now() - 5000, totalFindings: 0 });
      storage.saveSecurityScan({ scanId: 'sec_exp', scanType: 'exposure', scannedAt: Date.now(), totalFindings: 0 });

      const latest = storage.getLatestSecurityScan('full');
      expect(latest.id).toBe('sec_full');
    });

    it('should return null when no scans exist', () => {
      expect(storage.getLatestSecurityScan()).toBeNull();
    });
  });

  describe('getSecurityFindings', () => {
    beforeEach(() => {
      storage.saveSecurityScan({
        scanId: 'sec_findings',
        scanType: 'full',
        scannedAt: Date.now(),
        totalFindings: 3,
        findings: [
          { ruleId: 'S1', ruleName: '手机号', severity: 'medium', category: 'leakage', filePath: '/a.jsonl', lineNumber: 1 },
          { ruleId: 'S6', ruleName: 'DB连接', severity: 'critical', category: 'leakage', filePath: '/b.jsonl', lineNumber: 2 },
          { ruleId: 'port_exposure', ruleName: '端口暴露', severity: 'high', category: 'exposure', port: 22 },
        ],
      });
    });

    it('should return all findings for a scan', () => {
      const { findings, pagination } = storage.getSecurityFindings('sec_findings');
      expect(findings).toHaveLength(3);
      expect(pagination.total).toBe(3);
    });

    it('should filter by category', () => {
      const { findings } = storage.getSecurityFindings('sec_findings', { category: 'leakage' });
      expect(findings).toHaveLength(2);
      expect(findings.every(f => f.category === 'leakage')).toBe(true);
    });

    it('should filter by severity', () => {
      const { findings } = storage.getSecurityFindings('sec_findings', { severity: 'critical' });
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe('S6');
    });

    it('should paginate results', () => {
      const { findings, pagination } = storage.getSecurityFindings('sec_findings', { page: 1, pageSize: 2 });
      expect(findings).toHaveLength(2);
      expect(pagination.totalPages).toBe(2);
    });
  });

  describe('getSecurityHistory', () => {
    it('should return scans within the time range', () => {
      storage.saveSecurityScan({ scanId: 'sec_h1', scanType: 'full', scannedAt: Date.now(), totalFindings: 0 });
      storage.saveSecurityScan({ scanId: 'sec_h2', scanType: 'full', scannedAt: Date.now(), totalFindings: 1 });

      const history = storage.getSecurityHistory(7);
      expect(history).toHaveLength(2);
    });

    it('should filter history by scan type', () => {
      storage.saveSecurityScan({ scanId: 'sec_hist_full', scanType: 'full', scannedAt: Date.now(), totalFindings: 0 });
      storage.saveSecurityScan({ scanId: 'sec_hist_exp', scanType: 'exposure', scannedAt: Date.now(), totalFindings: 1 });

      const history = storage.getSecurityHistory(7, 'full');
      expect(history).toHaveLength(1);
      expect(history[0].scanType).toBe('full');
    });
  });

  describe('getScoreTimeline', () => {
    it('should filter timeline by scan type', () => {
      storage.saveSecurityScan({
        scanId: 'sec_tl_full',
        scanType: 'full',
        scannedAt: Date.now() - 5000,
        totalFindings: 0,
        securityScore: { score: 92, grade: 'A', label: 'Safe' },
      });
      storage.saveSecurityScan({
        scanId: 'sec_tl_exp',
        scanType: 'exposure',
        scannedAt: Date.now(),
        totalFindings: 1,
        securityScore: { score: 81, grade: 'B', label: 'Caution' },
      });

      const timeline = storage.getScoreTimeline(7, 'full');
      expect(timeline).toHaveLength(1);
      expect(timeline[0].score).toBe(92);
    });
  });

  describe('deduplication', () => {
    it('should ignore duplicate leakage findings', () => {
      const finding = { ruleId: 'S1', ruleName: '手机号', severity: 'medium', category: 'leakage', filePath: '/test.jsonl', lineNumber: 42 };

      storage.saveSecurityScan({
        scanId: 'sec_dedup1',
        scanType: 'leakage',
        scannedAt: Date.now(),
        totalFindings: 1,
        findings: [finding],
      });

      // Save again with same file/line/rule
      storage.saveSecurityScan({
        scanId: 'sec_dedup2',
        scanType: 'leakage',
        scannedAt: Date.now(),
        totalFindings: 1,
        findings: [finding],
      });

      // The second finding should be ignored due to UNIQUE index
      const { findings: f1 } = storage.getSecurityFindings('sec_dedup1');
      const { findings: f2 } = storage.getSecurityFindings('sec_dedup2');
      expect(f1).toHaveLength(1);
      expect(f2).toHaveLength(0); // deduped
    });
  });

  describe('cleanup', () => {
    it('should keep only the last 30 scans', () => {
      // Save 32 scans
      for (let i = 0; i < 32; i++) {
        storage.saveSecurityScan({
          scanId: `sec_cleanup_${i}`,
          scanType: 'full',
          scannedAt: Date.now() + i,
          totalFindings: 0,
        });
      }

      const history = storage.getSecurityHistory(365);
      expect(history.length).toBeLessThanOrEqual(30);
    });
  });
});
