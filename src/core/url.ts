import { lookup } from "node:dns/promises";
import net from "node:net";

import type { RuntimeConfig } from "./config.js";
import { WebRouterError } from "./types.js";

export interface UrlPolicyOptions {
  allowPrivateNetwork?: boolean;
}

export async function assertAllowedHttpUrl(
  rawUrl: string,
  config: RuntimeConfig,
  options: UrlPolicyOptions = {}
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebRouterError("invalid_url", "Expected a valid absolute URL.", { url: rawUrl });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebRouterError("unsupported_protocol", "Only http and https URLs are supported.", {
      protocol: url.protocol
    });
  }

  const host = url.hostname.toLowerCase();
  if (!hostMatchesAllowlist(host, config.allowedHosts)) {
    throw new WebRouterError("host_not_allowed", "The URL host is outside the configured RenderProof host allowlist.", {
      host,
      allowedHosts: config.allowedHosts
    });
  }

  const allowPrivateNetwork = options.allowPrivateNetwork === true || !config.blockPrivateNetwork;
  if (!allowPrivateNetwork) {
    await assertNotPrivateHost(host);
  }

  return url;
}

function hostMatchesAllowlist(host: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern.toLowerCase();
    if (normalized === "*") {
      return true;
    }
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === normalized;
  });
}

async function assertNotPrivateHost(host: string): Promise<void> {
  if (isLocalhostName(host)) {
    throw new WebRouterError("private_network_blocked", "Localhost URLs are blocked by default.", { host });
  }

  const directIpVersion = net.isIP(host);
  if (directIpVersion !== 0) {
    if (isPrivateIp(host)) {
      throw new WebRouterError("private_network_blocked", "Private network IPs are blocked by default.", {
        host
      });
    }
    return;
  }

  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    const privateAddress = addresses.find((entry) => isPrivateIp(entry.address));
    if (privateAddress) {
      throw new WebRouterError("private_network_blocked", "Host resolves to a private network address.", {
        host,
        address: privateAddress.address
      });
    }
  } catch (error) {
    if (error instanceof WebRouterError) {
      throw error;
    }
    throw new WebRouterError("dns_lookup_failed", "Could not resolve URL host.", {
      host,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

function isLocalhostName(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost");
}

function isPrivateIp(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized === "::"
    );
  }

  return false;
}
