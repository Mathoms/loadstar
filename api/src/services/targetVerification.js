import crypto from "node:crypto";
import { pool, audit } from "../db.js";
import dns from "node:dns/promises";
import { isPrivateAddress } from "../middleware/security.js";

/**
 * A cloud load platform is a DDoS cannon if unguarded. Before Loadstar will
 * fire load at a public domain, the owner must prove control of it by serving
 * a token at  https://<domain>/.well-known/loadstar-verify.txt
 *
 * Private/localhost targets skip verification when ALLOW_PRIVATE_TARGETS=true
 * (self-hosted teams testing internal apps — the on-prem story).
 */

export async function getOrCreateToken(domain) {
  const existing = await pool.query("SELECT * FROM verified_targets WHERE domain=$1", [domain]);
  if (existing.rows[0]) return existing.rows[0];
  const token = "loadstar-" + crypto.randomBytes(24).toString("hex");
  const inserted = await pool.query(
    "INSERT INTO verified_targets (domain, token) VALUES ($1,$2) RETURNING *",
    [domain, token]
  );
  return inserted.rows[0];
}

export async function attemptVerification(domain) {
  const row = await getOrCreateToken(domain);
  if (row.verified) return { verified: true };
  const url = `https://${domain}/.well-known/loadstar-verify.txt`;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(url, { signal: ctl.signal, redirect: "manual" });
    clearTimeout(timer);
    if (res.ok) {
      const body = (await res.text()).trim();
      if (body === row.token) {
        await pool.query(
          "UPDATE verified_targets SET verified=TRUE, verified_at=now() WHERE domain=$1",
          [domain]
        );
        await audit("system", "target.verified", domain);
        return { verified: true };
      }
    }
    return { verified: false, reason: `Token not found or mismatched at ${url}` };
  } catch (e) {
    return { verified: false, reason: `Could not fetch ${url}: ${e.message}` };
  }
}

/* Resolve a hostname and return every A/AAAA address, or null on failure.
 * A resolution FAILURE is treated as unsafe by the caller — fail closed. */
async function resolveAll(host) {
  if (net_isIP(host)) return [host];
  const addrs = [];
  try { for (const a of await dns.resolve4(host)) addrs.push(a); } catch { /* no A */ }
  try { for (const a of await dns.resolve6(host)) addrs.push(a); } catch { /* no AAAA */ }
  return addrs.length ? addrs : null;
}

/* net.isIP without importing net here — targetVerification stays lean. */
function net_isIP(s) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(s) || s.includes(":");
}

/* The SSRF gate. isPrivateAddress() only inspects the STRING; it never resolves.
 * So a VERIFIED public domain that RESOLVES to an internal IP (metadata, RFC1918,
 * loopback) sailed straight through. Resolve, then check EVERY address — a domain
 * with one public and one private A record must be rejected, not averaged. */
export async function targetResolvesToPrivate(targetUrl) {
  let host;
  try { host = new URL(targetUrl).hostname; } catch { return { blocked: true, reason: "Unparseable target URL." }; }

  const addrs = await resolveAll(host);
  if (!addrs) {
    // Fail CLOSED: if we cannot resolve it, we cannot prove it is safe.
    return { blocked: true, reason: `Could not resolve ${host} to verify it is not internal.` };
  }
  for (const ip of addrs) {
    if (isPrivateAddress(ip)) {
      return {
        blocked: true,
        reason: `${host} resolves to ${ip}, which is a private/internal/metadata address. ` +
          `Refusing to send load there \u2014 this is how a load tester becomes an SSRF weapon ` +
          `against your own cloud metadata or internal network.`,
        resolved: addrs,
      };
    }
  }
  return { blocked: false, resolved: addrs };
}

export async function isTargetAllowed(targetUrl) {
  const host = new URL(targetUrl).hostname;
  if (process.env.ALLOW_PRIVATE_TARGETS === "true" && isPrivateAddress(host)) return { allowed: true };
  if (process.env.SKIP_TARGET_VERIFICATION === "true") return { allowed: true }; // dev only

  const row = await pool.query(
    "SELECT verified FROM verified_targets WHERE domain=$1 AND verified=TRUE",
    [host]
  );
  if (!row.rows[0]) {
    return { allowed: false, reason: `Domain ${host} is not verified. POST /api/targets/verify first.` };
  }

  /* VERIFIED IS NOT ENOUGH. Owning a domain does not make it safe to point load
     at: a verified domain can resolve to 169.254.169.254 or 10.0.0.5. Resolve now
     and refuse if it points anywhere internal. This is the SSRF gate. */
  const dnsCheck = await targetResolvesToPrivate(targetUrl);
  if (dnsCheck.blocked) {
    return { allowed: false, reason: dnsCheck.reason };
  }

  return { allowed: true };
}

/**
 * Collect all distinct domains a test will hit: its base target_url plus any
 * request whose path is a full absolute URL (http:// or https://). Returns a
 * de-duplicated array of hostnames. Path-only requests inherit the base domain.
 */
export function collectDomains(test) {
  const domains = new Set();
  const add = (u) => { try { domains.add(new URL(u).hostname); } catch {} };
  if (test.target_url) add(test.target_url);
  const reqs = Array.isArray(test.requests) ? test.requests : [];
  for (const r of reqs) {
    const p = (r && r.path) ? String(r.path) : "";
    if (/^https?:\/\//i.test(p)) add(p);
  }
  return [...domains];
}
