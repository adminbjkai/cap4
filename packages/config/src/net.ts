import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// SSRF guard for user-supplied webhook URLs. Shared by web-api (validation at
// save time) and the worker (re-validation at delivery time, so a DNS change
// between save and delivery can't redirect the request at internal services).

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "minio",
  "postgres",
  "media-server",
  "web-api",
  "worker",
  "web-internal",
  "metadata.google.internal"
]);

export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const octets = ip.split(".").map(Number);
    const [a, b] = octets;
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return true;
    return (
      a === 0 || // 0.0.0.0/8
      a === 10 || // 10/8
      a === 127 || // loopback
      (a === 100 && b! >= 64 && b! <= 127) || // 100.64/10 CGNAT
      (a === 169 && b === 254) || // link-local incl. 169.254.169.254
      (a === 172 && b! >= 16 && b! <= 31) || // 172.16/12
      (a === 192 && b === 168) // 192.168/16
    );
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d) — classify the embedded v4 address.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    if (lower === "::" || lower === "::1") return true;
    return (
      lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb") || // fe80::/10
      lower.startsWith("fc") || lower.startsWith("fd") // fc00::/7 ULA
    );
  }
  // Not a recognizable IP literal.
  return false;
}

export type WebhookUrlCheck = { ok: true } | { ok: false; reason: string };

export function checkWebhookUrlSyntax(rawUrl: string): WebhookUrlCheck & { hostname?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "webhookUrl is not a valid URL" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, reason: "webhookUrl must use http or https" };
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local") ||
    (isIP(hostname) !== 0 && isPrivateIp(hostname))
  ) {
    return { ok: false, reason: "webhookUrl cannot target internal services" };
  }
  return { ok: true, hostname };
}

/** Full check: syntax + hostname denylist + DNS resolution against private ranges. */
export async function checkWebhookUrl(rawUrl: string): Promise<WebhookUrlCheck> {
  const syntax = checkWebhookUrlSyntax(rawUrl);
  if (!syntax.ok) return syntax;
  const hostname = syntax.hostname!;
  if (isIP(hostname) !== 0) return { ok: true }; // IP literal already classified above
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, reason: "webhookUrl hostname does not resolve" };
  }
  if (addresses.length === 0 || addresses.some((addr) => isPrivateIp(addr.address))) {
    return { ok: false, reason: "webhookUrl cannot target internal services" };
  }
  return { ok: true };
}
