# Contributing to Loadstar

Thanks for considering it. Loadstar is young, moving fast, and genuinely wants
contributors — this document is short on ceremony and long on the things that will
actually get your PR merged.

## Getting a dev environment

```bash
git clone https://github.com/kalkiyama/loadstar.git && cd loadstar
cp .env.example .env
docker compose up --build        # db + api + worker + browser-worker + demo targets
# UI at http://localhost:8080
```

Everything runs in Docker; you don't need local Postgres, JMeter, or k6. For API-only
iteration, `cd api && npm install && npm test` works standalone.

## Where to start

Issues labeled **`good first issue`** are scoped, self-contained, and come with file
pointers. Issues labeled **`help wanted`** are bigger but designed. If you want to work
on something unlabeled, open an issue first so nobody duplicates effort.

## The one rule that is enforced without exception

**Verification must exercise the real code.** If you add or change behavior, the test or
`verify_*.mjs` script must import/call the actual implementation — never a copied or
reimplemented version of it. This project once shipped a verify script with its own
inlined copy of the logic it verified; the copy drifted, CI went red on correct code,
and the rule became structural (see `api/src/lib/ssrfGuard.js` for the pattern). PRs
that inline logic into tests will be asked to import instead.

## What a good PR looks like

- **One concern per PR.** A fix and a refactor are two PRs.
- **Proof over promises.** Show the behavior: a test, a verify script run, or a
  before/after in the PR description. "Should work" is not a state of the world.
- **Match the existing style.** Plain Node ESM, no build step for the web UI (it's a
  zero-build SPA on purpose), parameterized SQL everywhere, no new dependencies without
  a reason stated in the PR.
- **Security-relevant changes** (anything touching auth, SSRF checks, input validation,
  script execution) get extra scrutiny and must update `SECURITY.md` if the posture
  changes.

## Running the checks CI will run

```bash
# fast, no stack needed:
for f in $(find api worker -name '*.js' -not -path '*/node_modules/*'); do node --check "$f"; done
node verify_ssrf.mjs
for t in worker/test/*.test.mjs; do node "$t"; done
node ci/check-sql-params.mjs

# full stack (what the smoke job does):
docker compose up -d --build
node verify_per_endpoint.mjs && node verify_ttft.mjs && node verify_expected_status.mjs
```

## Reporting bugs & proposing features

Use the issue templates. For bugs, the fastest path to a fix is: what you did, what you
expected, what happened, and the `[api]` / `[worker]` log lines from the terminal.

## Security issues

Do **not** open a public issue. Use GitHub's private security advisory on this repo.
See `SECURITY.md`.

## Licensing

Loadstar is Apache-2.0. By contributing, you agree your contributions are licensed the
same way. Note the engines Loadstar invokes carry their own licenses (k6 is AGPL-3.0 —
see `THIRD_PARTY.md`).
