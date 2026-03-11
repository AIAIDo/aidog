/**
 * Get public IP address with multi-source fallback.
 * @param {number} [timeout=5000]
 * @returns {Promise<string|null>}
 */
export async function getPublicIp(timeout = 5000) {
  const services = [
    { url: 'https://api.ipify.org?format=json', extract: (d) => d.ip },
    { url: 'https://api.my-ip.io/v2/ip.json', extract: (d) => d.ip },
    { url: 'https://httpbin.org/ip', extract: (d) => d.origin },
  ];

  for (const service of services) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(service.url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) continue;

      const data = await res.json();
      const ip = service.extract(data);
      if (ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip.trim())) {
        return ip.trim();
      }
    } catch {
      continue;
    }
  }

  return null;
}
