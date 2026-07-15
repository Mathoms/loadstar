import net from "node:net";

/**
 * Reject targets that resolve to private/loopback ranges unless explicitly
 * allowed (SSRF guard).
 *
 * DEPENDENCY-FREE ON PURPOSE: this file imports nothing but node:net. It is
 * the single source of truth for "is this address internal", shared by the
 * running app (via middleware/security.js) and by verify_ssrf.mjs, which
 * asserts this exact function against real DNS resolution with no DB and no
 * running stack. A verify script that re-implements this logic instead of
 * importing it can drift from the real code and stop proving anything — see
 * git history for the [::1] bracket-stripping regression that slipped past a
 * stale inlined copy.
 */
export function isPrivateAddress(host) {
  // Normalise IPv4-mapped IPv6 (::ffff:1.2.3.4) to its IPv4 form so the ranges below
  // catch it — otherwise ::ffff:169.254.169.254 slips past every IPv4 regex.
  // new URL(...).hostname keeps brackets on IPv6 literals ("[::1]"). Strip them,
  // or every bracketed IPv6 address bypasses every check below.
  host = String(host || "").replace(/^\[|\]$/g, "");
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host);
  if (m) host = m[1];
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  // Single-label names (no dot AND no colon) are internal service names, e.g.
  // docker-compose's "demo". A public IPv6 address has no dots but DOES have colons —
  // without the colon guard, this rule blocked every public IPv6 target.
  if (!host.includes(".") && !host.includes(":")) return true;
  if (net.isIP(host)) {
    return (
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host) ||          // link-local — includes cloud metadata (169.254.169.254)
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) || // 100.64.0.0/10 carrier-grade NAT
      host === "0.0.0.0" ||
      host === "::1" ||
      host === "::" ||
      /^fe80/i.test(host) ||                 // IPv6 link-local (the 169.254 of IPv6)
      /^f[cd]/i.test(host) ||                // IPv6 ULA
      /^::ffff:/i.test(host)                 // IPv4-mapped IPv6 — re-check the embedded v4 below
    );
  }
  return false;
}
