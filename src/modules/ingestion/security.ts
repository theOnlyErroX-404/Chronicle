import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { LookupAddress } from "node:dns";
import { ChronicleError } from "@/modules/shared/errors";

const isPrivateIpv4 = (ip: string) => {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
};

const isPrivateIpv6 = (ip: string) => {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fec0:")) return true;
  // IPv4-embedded forms (IPv4-mapped ::ffff: and NAT64 64:ff9b::). Reject when
  // the embedded IPv4 is itself private — resolvers may hand back either the
  // dotted form or the hex form (e.g. "::ffff:7f00:1").
  const embedded = normalized.replace(/^(::ffff:|64:ff9b::)/, "");
  if (embedded !== normalized) {
    const dotted = embedded.match(/(?:\d{1,3}\.){3}\d{1,3}/)?.[0];
    if (dotted) return isPrivateIpv4(dotted);
    const parts = embedded.split(":").filter(Boolean);
    let value = 0;
    for (const part of parts) value = value * 0x10000 + Number.parseInt(part, 16);
    const mapped = `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
    return isPrivateIpv4(mapped);
  }
  return false;
};

export type HostResolver = (hostname: string) => Promise<LookupAddress[]>;

const defaultResolver: HostResolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

// A URL plus the exact addresses the hostname resolved to after the public-IP
// check passed. The fetch layer connects to these addresses and never performs
// its own DNS lookup, so a DNS rebinding between validation and connect cannot
// redirect the request at a private address.
export type SafePublicUrl = {
  url: URL;
  addresses: LookupAddress[];
};

export const resolveSafePublicUrl = async (rawUrl: string, resolveHost: HostResolver = defaultResolver): Promise<SafePublicUrl> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ChronicleError("A valid report URL is required.");
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new ChronicleError("Only unauthenticated HTTP(S) report URLs are allowed.");
  }

  const rejectUnsafe = () => {
    throw new ChronicleError("URLs resolving to private or local network addresses are not allowed.", 400, "https://chronicle.local/problems/unsafe-url");
  };

  let hostname = url.hostname;
  if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
  const family = isIP(hostname);
  if (family) {
    if (family === 4 ? isPrivateIpv4(hostname) : isPrivateIpv6(hostname)) rejectUnsafe();
    return { url, addresses: [{ address: hostname, family }] };
  }

  const addresses = await resolveHost(hostname).catch(() => {
    throw new ChronicleError("The report host could not be resolved.");
  });
  if (!addresses.length || addresses.some(({ address, family: resolvedFamily }) => (resolvedFamily === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address)))) rejectUnsafe();
  return { url, addresses };
};
