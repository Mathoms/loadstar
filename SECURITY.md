# Security posture

Loadstar is security-relevant in two directions: it must be a hard target
itself, and it must not become a weapon. Both are treated as product
requirements, not afterthoughts.

## Implemented in this MVP

**Abuse prevention (a load platform is a DDoS cannon if unguarded)**
- Domain ownership verification before any public target can receive load
  (`/.well-known/loadstar-verify.txt` token check)
- Private/loopback address ranges blocked by default (SSRF + internal-scan guard);
  opt-in via `ALLOW_PRIVATE_TARGETS` for self-hosted internal testing
- Hard caps on virtual users and duration (`MAX_VIRTUAL_USERS`, `MAX_DURATION_SECS`)

**Platform hardening**
- API-key authentication (`X-API-Key`), designed to be replaced by full
  user accounts + RBAC + SSO/SAML in the SaaS phase
- Rate limiting on all routes; JSON body size capped at 256 KB
- Security headers via helmet, including a restrictive CSP
- Parameterized SQL everywhere — no string-built queries
- Input validation on every write endpoint; HTML escaping in the UI
- Central error handler: stack traces never reach clients
- Audit log table recording test creation, run lifecycle, and verifications

**Data boundaries**
- Claude receives aggregated metrics only — never response bodies, request
  headers, or credentials
- Worker temp directories (JMX/JTL) deleted after every run
- Secrets come exclusively from environment variables; `.env` is gitignored

## Operational cautions — read these

### Debug traces contain real secrets

Running a test with `debug: true` captures the **full request and response headers of
every request** — including `Authorization` headers carrying real tokens extracted from
a login step. That is the entire point: it is how you see whether response chaining
actually worked.

The consequence is that **those tokens are stored in plaintext** in the `runs.debug_trace`
column, are visible to anyone with API access, appear in database backups, and are
rendered in the UI.

- Run debug traces against **non-production credentials** only.
- Delete debug runs once you have what you need.
- **Treat a Loadstar database as containing secrets**, and back it up accordingly.

This is a deliberate trade-off, not an oversight — a debug trace that redacted the token
would not tell you whether the token was correct. But it should be a choice you make
knowingly.

### Never enable mock auth in production

`ENABLE_MOCK_AUTH=true` exposes `/api/mock/login`, which **issues a valid bearer token to
anyone who asks**, and `/api/mock/protected`, which accepts it. These exist only to prove
response chaining works against a known-good endpoint.

The default is `false`. Never enable it on a shared or internet-facing instance.

## Required before public SaaS launch

1. Real identity: user accounts, org tenancy, RBAC, then SSO/SAML (enterprise)
2. Secrets vault for stored test credentials (e.g., encrypted with KMS,
   never returned by the API after write)
3. Per-tenant isolation review: queries scoped by org id, tested with
   automated cross-tenant probes
4. TLS termination + HSTS at the edge; Postgres TLS in transit
5. Dependency and container scanning in CI (npm audit, Trivy) + Dependabot
6. Abuse monitoring: per-account load quotas, anomaly alerts, kill switch
7. Pen test before charging money; SOC 2 Type II on the enterprise path
8. Responsible disclosure policy (SECURITY.md contact + 90-day window)

## Reporting a vulnerability

Open a private security advisory on the repository, or email the
maintainers. Please do not open public issues for security reports.

## SSRF: resolve-time check, with a documented residual window

Before sending load at a verified domain, Loadstar resolves it and refuses if any
resolved address is private, loopback, link-local, or cloud-metadata
(169.254.169.254). Owning a domain is not sufficient — a verified domain that
resolves to an internal IP would otherwise turn the load generator into an SSRF
weapon against your own network or cloud metadata endpoint.

**Residual (known, tracked):** a TOCTOU window of a few seconds exists between this
check and the load engine's own DNS lookup. Fully closing it requires pinning the
resolved IP through both k6 and JMeter while preserving the Host header. Exploiting
the window requires an attacker who already controls the target's DNS and has passed
domain verification.
