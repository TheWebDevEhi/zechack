import dns from 'dns';
import net from 'net';
import { URL } from 'url';

/**
 * Checks whether an IPv4 address belongs to a reserved, private, loopback, or cloud-metadata range.
 */
function isRestrictedIpv4(ip: string, allowLocalhost: boolean = false): boolean {
  if (!net.isIPv4(ip)) return false;
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed treated as restricted
  }

  const [a, b] = parts;

  // 0.0.0.0/8 - Current network
  if (a === 0) return true;

  // 10.0.0.0/8 - Private
  if (a === 10) return true;

  // 100.64.0.0/10 - Carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 127.0.0.0/8 - Loopback
  if (a === 127) {
    return !allowLocalhost;
  }

  // 169.254.0.0/16 - Link-local / Cloud metadata (AWS, GCP, Azure 169.254.169.254)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 - Private
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.0.0.0/24 - IETF protocol assignments
  if (a === 192 && b === 0 && parts[2] === 0) return true;

  // 192.0.2.0/24 - Documentation (TEST-NET-1)
  if (a === 192 && b === 0 && parts[2] === 2) return true;

  // 192.168.0.0/16 - Private
  if (a === 192 && b === 168) return true;

  // 198.18.0.0/15 - Benchmark testing
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 198.51.100.0/24 - Documentation (TEST-NET-2)
  if (a === 198 && b === 51 && parts[2] === 100) return true;

  // 203.0.113.0/24 - Documentation (TEST-NET-3)
  if (a === 203 && b === 0 && parts[2] === 113) return true;

  // 224.0.0.0/4 - Multicast
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4 - Reserved
  if (a >= 240) return true;

  return false;
}

/**
 * Checks whether an IPv6 address belongs to a reserved, private, or loopback range.
 */
function isRestrictedIpv6(ip: string, allowLocalhost: boolean = false): boolean {
  if (!net.isIPv6(ip)) return false;
  const normalized = ip.toLowerCase();

  // Loopback / Unspecified
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
    return !allowLocalhost;
  }
  if (normalized === '::') return true;

  // IPv4-mapped IPv6 (::ffff:192.0.2.128 or ::ffff:7f00:1)
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.slice('::ffff:'.length);
    if (v4Part.includes('.')) {
      return isRestrictedIpv4(v4Part, allowLocalhost);
    }
  }

  // Unique local addresses (fc00::/7)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // Link-local unicast (fe80::/10)
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true;
  }

  // Multicast (ff00::/8)
  if (normalized.startsWith('ff')) return true;

  return false;
}

export interface WebhookUrlValidationResult {
  isValid: boolean;
  error?: string;
  resolvedIps?: string[];
}

/**
 * Validates a target webhook URL against SSRF vulnerabilities:
 * - Scheme must be HTTPS (or HTTP if allowHttp is explicitly enabled).
 * - Hostname cannot be localhost or internal naming (unless allowLocalhost is set).
 * - Resolves all DNS A/AAAA records and rejects any private, loopback, or cloud-metadata IP.
 */
export async function validateWebhookUrl(
  urlStr: string,
  allowHttp: boolean = false,
  allowLocalhost: boolean = false
): Promise<WebhookUrlValidationResult> {
  if (!urlStr || typeof urlStr !== 'string') {
    return { isValid: false, error: 'Target URL is required' };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    return { isValid: false, error: 'Malformed URL format' };
  }

  // Scheme validation
  if (parsed.protocol !== 'https:' && (!allowHttp || parsed.protocol !== 'http:')) {
    return {
      isValid: false,
      error: `Invalid protocol: "${parsed.protocol}". Only HTTPS endpoints are permitted in production.`
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Basic hostname checks
  if (!hostname || (!allowLocalhost && hostname === 'localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { isValid: false, error: `Disallowed hostname: "${hostname}"` };
  }

  // If hostname is directly an IP literal
  if (isRestrictedIpv4(hostname, allowLocalhost) || isRestrictedIpv6(hostname, allowLocalhost)) {
    return { isValid: false, error: `Target URL references a private, loopback, or metadata IP address` };
  }

  // DNS resolution to defend against domain mapping to private IPs
  try {
    const lookupResults = await dns.promises.lookup(hostname, { all: true });
    if (!lookupResults || lookupResults.length === 0) {
      return { isValid: false, error: `Could not resolve hostname "${hostname}"` };
    }

    const resolvedIps = lookupResults.map((r) => r.address);

    for (const record of lookupResults) {
      const isRestricted =
        record.family === 4 ? isRestrictedIpv4(record.address, allowLocalhost) : isRestrictedIpv6(record.address, allowLocalhost);

      if (isRestricted) {
        return {
          isValid: false,
          error: `Hostname "${hostname}" resolves to restricted IP: ${record.address}`,
          resolvedIps
        };
      }
    }

    return { isValid: true, resolvedIps };
  } catch (err: any) {
    return { isValid: false, error: `DNS resolution failed for "${hostname}": ${err.message}` };
  }
}
