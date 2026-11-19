/**
 * SSRF protection for outbound HTTP requests made by workflow nodes.
 * - Only http/https schemes
 * - Blocks loopback, private, link-local (incl. cloud metadata) addresses
 * - Validates every redirect hop manually
 * - Enforces timeouts and response size limits
 */
import dns from "dns/promises";
import net from "net";

const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
]);

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true; // loopback + private
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:")) return isBlockedIp(lower.slice(7));
  return false;
}

export class SsrfError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SsrfError";
  }
}

export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Blocked protocol "${url.protocol}". Only http/https allowed.`);
  }
  if (BLOCKED_HOSTNAMES.has(url.hostname.toLowerCase())) {
    throw new SsrfError(`Blocked host: ${url.hostname}`);
  }
  // Resolve hostname (unless already an IP)
  let ips: string[] = [];
  if (net.isIP(url.hostname)) {
    ips = [url.hostname];
  } else {
    try {
      const records = await dns.lookup(url.hostname, { all: true });
      ips = records.map((r) => r.address);
    } catch {
      throw new SsrfError(`Cannot resolve host: ${url.hostname}`);
    }
  }
  for (const ip of ips) {
    if (isBlockedIp(ip)) {
      throw new SsrfError(
        `Blocked target address ${ip} (private, loopback, or metadata network).`
      );
    }
  }
  return url;
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  truncated: boolean;
  url: string;
}

const DEFAULT_TIMEOUT = 30_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB response cap

/** Fetch with SSRF validation on every redirect hop, timeout, size cap. */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT,
    maxBytes = MAX_BYTES,
    maxRedirects = 3,
  } = options;

  let currentUrl = await assertPublicUrl(rawUrl);
  let redirects = 0;
  let response: Response;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(currentUrl, {
        method: redirects === 0 ? method : "GET",
        headers: redirects === 0 ? headers : {},
        body: redirects === 0 ? body : undefined,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err: unknown) {
      const e = err as Error;
      if (e.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw new Error(`Network error: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) break;
      if (redirects >= maxRedirects) {
        throw new Error(`Too many redirects (>${maxRedirects})`);
      }
      redirects += 1;
      currentUrl = await assertPublicUrl(new URL(location, currentUrl).toString());
      continue;
    }
    break;
  }

  // Read body with size cap
  const reader = response.body?.getReader();
  let bodyText = "";
  let truncated = false;
  if (reader) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        truncated = true;
        reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }
    bodyText = new TextDecoder().decode(merged);
  }

  const respHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    respHeaders[k] = k.toLowerCase() === "authorization" ? "[redacted]" : v;
  });

  return {
    status: response.status,
    headers: respHeaders,
    bodyText,
    truncated,
    url: currentUrl.toString(),
  };
}
