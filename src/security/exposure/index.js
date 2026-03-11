import { v4 as uuidv4 } from 'uuid';
import { getPublicIp } from './public-ip.js';
import { scanPorts, scanLocalBindings, DEFAULT_PORTS } from './port-scanner.js';
import { detectTunnels } from './process-scanner.js';
import { detectProxySuspected } from './proxy-suspect.js';

/**
 * ExposureChecker — checks for public network exposure.
 */
export class ExposureChecker {
  /**
   * Run full exposure check.
   * @param {Object} [options]
   * @param {number} [options.timeout=3000]
   * @param {number[]} [options.ports]
   * @returns {Promise<import('../types.js').ExposureScanResult>}
   */
  async check(options = {}) {
    const scanId = options.scanId || `sec_${uuidv4().slice(0, 12)}`;
    const timeout = options.timeout || 3000;
    const forceProxyPortScan = process.env.AIDOG_SECURITY_ALLOW_PROXY_PORT_SCAN === '1';
    const proxy = detectProxySuspected();

    // Step 1: Get public IP
    const publicIp = await getPublicIp();

    // Step 2: Detect tunnel processes (always runs)
    const tunnelFindings = detectTunnels();

    // Step 3: Port scanning (only if we have a public IP)
    let portFindings = [];
    let note;

    const portsToScan = options.ports
      ? options.ports.map(p => {
          const known = DEFAULT_PORTS.find(dp => dp.port === p);
          return known || { port: p, service: `Port ${p}`, severity: 'medium' };
        })
      : DEFAULT_PORTS;

    if (proxy.proxySuspected && !forceProxyPortScan) {
      const reasonText = proxy.reasons.length > 0 ? `原因：${proxy.reasons.join('；')}。` : '';
      note = `疑似代理/TUN环境，公网 IP 可能为代理出口地址，已跳过端口可达性检测以避免误报。${reasonText}若需强制扫描，请设置 AIDOG_SECURITY_ALLOW_PROXY_PORT_SCAN=1。`;
    } else if (publicIp) {
      portFindings = await scanPorts(publicIp, portsToScan, timeout);
    } else {
      note = '无法获取公网 IP，跳过端口可达性检测';
    }

    // Step 4: Local binding scan (always runs — detects 0.0.0.0 listeners)
    const localBindingFindings = await scanLocalBindings(portsToScan);

    const result = {
      scanId,
      scannedAt: new Date(),
      publicIp,
      portFindings,
      localBindingFindings,
      tunnelFindings,
      totalFindings: portFindings.length + localBindingFindings.length + tunnelFindings.length,
      proxyDetected: proxy.proxyDetected,
      proxySuspected: proxy.proxySuspected,
      proxyReasons: proxy.reasons,
    };

    if (note) result.note = note;

    return result;
  }
}
