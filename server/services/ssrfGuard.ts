import dns from "dns/promises";
import net from "net";

// Ranges a server-side fetch to an admin-supplied URL must never reach:
// loopback, RFC1918 private space, link-local (which on cloud hosts serves
// the instance-metadata endpoint at 169.254.169.254), and a few less common
// reserved blocks. Not exhaustive IPv6 policy — covers the realistic
// internal targets (loopback, unique-local, link-local, v4-mapped).
const BLOCKED_V4_RANGES: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
];

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const target = ipToInt(ip);
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = (~0 << (32 - bits)) >>> 0;
    return (target & mask) === (ipToInt(base) & mask);
  });
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
  if (lower.startsWith("::ffff:")) return isBlockedV4(lower.slice(7));
  return false;
}

// Resolves the hostname and rejects the URL if any resolved address (or the
// literal IP, if given directly) is loopback/private/link-local — the
// standard SSRF guard for a server-side fetch to a user-supplied URL.
// Call this both when the URL is saved and again right before each delivery
// attempt, since DNS can change between the two (rebinding).
export async function isSsrfSafeUrl(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const hostname = parsed.hostname;
  if (hostname === "localhost") return false;
  const ipVersion = net.isIP(hostname);
  if (ipVersion) return ipVersion === 4 ? !isBlockedV4(hostname) : !isBlockedV6(hostname);
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.length === 0) return false;
    return records.every((r) => (r.family === 4 ? !isBlockedV4(r.address) : !isBlockedV6(r.address)));
  } catch {
    return false;
  }
}
