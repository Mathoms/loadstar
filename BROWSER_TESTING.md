# Browser testing guide (for complete beginners)

Loadstar now has two kinds of tests, and it helps to understand the difference
in one breath:

- **Load test** — sends lots of raw requests to answer *"is it fast when busy?"*
- **Browser test** — opens a real Chrome browser and clicks through your site
  like a human, to answer *"does it actually work?"*

Browser testing is what tools like **Selenium** and **Playwright** are famous
for. Normally they require writing code. In Loadstar you build the test by
filling in steps — no code — and Playwright runs a real browser behind the
scenes. (Importing existing Selenium scripts is on the roadmap; the steps you
build here are engine-neutral on purpose.)

---

## Part 1 — Your first browser test (5 minutes, totally safe)

We'll test the built-in practice site so nothing real is touched.

1. Start Loadstar (`docker compose up`) and open **http://localhost:8080**.
2. On the New test screen, click the **Browser test** button at the top of
   the form. The form changes: load-testing fields disappear and a **Steps**
   section appears.
3. Fill in:
   - **Test name:** `My first browser test`
   - **Start page URL:** `http://demo`
   - **Parallel users:** `1`
   - **Repeats per user:** `1`
4. Your first step is already there. Set it to:
   - Action: **Expect to see text**
   - Value: `Welcome to nginx!`

   (That's the headline on the practice site's homepage. The test will open
   the page and check that text really appears.)
5. Click **Save & run test**.

In about 15 seconds the report shows: flows passed **1/1**, pass rate
**100%**, a steps table with the time each step took, and Claude's plain-
English verdict.

**Now watch it fail on purpose** (failures are where testing gets useful):
create the same test again but expect the text `Welcome to Mars!`. The report
will show the failed step, the exact error, and a **screenshot of what the
browser was looking at** when it failed — the single most useful thing in
browser testing.

---

## Part 2 — Understanding steps and selectors

Every browser test is: *open the start page, then do the steps in order.*
If any step fails, that user's flow stops and gets photographed.

### The actions

| Action | What it does | Needs |
|---|---|---|
| **Click** | Clicks a button or link | a selector |
| **Type into** | Types text into a box | a selector + the text |
| **Expect to see text** | Checks some text is on the page | the text |
| **Go to another page** | Navigates to a new URL | a full URL |
| **Wait for element** | Waits until something appears | a selector |
| **Pause (ms)** | Waits a fixed time (use sparingly) | milliseconds |

### Check steps — the ones that make a test mean something

Clicks and fills only prove the *mechanics* worked. They prove nothing about whether the
page was **right**. A flow that clicks through a totally broken checkout — every page
rendering an error — still passes, because clicking an element that exists never throws.

Add check steps and that stops being true:

- **Check: text appears** — e.g. `Order confirmed`. Fails if it never shows up.
- **Check: text is NOT there** — e.g. `Error`. This is the one most people are missing.
  Put it after each meaningful step and a broken page fails loudly instead of passing quietly.
- **Check: element is visible** — e.g. `#confirmation-banner`. For things without distinctive text.
- **Check: URL contains** — e.g. `/checkout`. Catches a button that silently did nothing.

Checks wait for the page to settle before deciding, so async content works without a manual pause.
A failed check ends the flow, records a readable error, and **captures a screenshot** of the page
at that moment — usually the fastest way to see what went wrong.

### Selectors, explained like you're new (because you are — that's fine)

A **selector** tells the browser *which thing* on the page to click or type
into. Three kinds cover 95% of real testing, easiest first:

1. **By visible text — use this whenever you can.**
   `text=Sign in` means "the thing that says Sign in".
   `text=Add to cart`, `text=Submit`, `text=Next` — if a human can see the
   words, you can select by them.

2. **By id.** Many page elements have a unique name called an *id*.
   The selector is `#` plus the id: `#email`, `#password`, `#search-box`.

3. **By CSS class** (last resort): a dot plus the class name, like
   `.submit-button`.

**How to find an id when text won't do:** open your site in Chrome,
right-click the box you care about, choose **Inspect**. A panel opens with
that element highlighted, looking something like
`<input id="email" type="text">` — the `id="email"` part means your selector
is `#email`. That's the entire skill. Close the panel and carry on.

### A realistic example — testing a login flow

Start page URL: `https://staging.yoursite.com/login`

| # | Action | Selector | Value |
|---|---|---|---|
| 1 | Type into | `#email` | `testuser@yoursite.com` |
| 2 | Type into | `#password` | `TestPass123` |
| 3 | Click | `text=Sign in` | |
| 4 | Expect to see text | | `Welcome back` |

Four steps, zero code — and it's a genuine regression test: run it after
every change to your site, and if login ever breaks, this fails loudly with
a screenshot.

---

## Part 3 — From single user to multiple users

Set **Parallel users** to 3 and **Repeats per user** to 2, and Loadstar
launches three simultaneous browsers, each running your flow twice —
six flows total. The report aggregates everything: pass rate across all
flows, and per-step average times.

Why multiple users matters even for functional testing: some bugs only
appear when two people do the same thing at once (double-booking a seat,
race conditions on checkout). A few parallel real browsers catch what a
single run can't.

**Why the limit is small (5 users):** each user is a *real Chrome browser* —
heavy on memory and CPU. This is exactly why the industry does big load
tests with JMeter-style raw requests (thousands of users, cheap) and keeps
real-browser tests small. Loadstar gives you both, and the honest guidance
is: browser tests prove correctness, load tests prove capacity. You can
raise the cap with `MAX_BROWSER_USERS` in `.env` if your machine can take it.

---

## Part 4 — Reading a browser test report

- **Flows passed / Pass rate** — a *flow* is one user completing all steps
  once. 5/6 means one user's journey broke.
- **Avg / Slowest flow time** — how long the whole journey takes. If login
  takes 9 seconds, that's a finding even when everything "passes".
- **Steps table** — per step: how many times it passed, average duration,
  and the first error message seen. The slowest step is usually your
  optimization target.
- **Failure screenshots** — what the browser saw at the moment of failure.
  Check these before anything else; they usually make the cause obvious
  (error banner, wrong page, cookie popup blocking the button).
- **AI analysis** — Claude reads the aggregate results (never your
  screenshots — those stay on your machine) and gives a verdict and next
  steps.

---

## Troubleshooting

| Problem | Likely cause & fix |
|---|---|
| Step fails with "Timeout … waiting for selector" | The selector doesn't match anything. Re-check with right-click → Inspect, or switch to a `text=` selector. |
| Click step fails but the button exists | A cookie/consent popup is covering it. Add an earlier step: Click `text=Accept` (or whatever the popup's button says). |
| "Expected to see the text … but it never appeared" | Either it's genuinely broken (congrats, the test worked) or the text is spelled slightly differently — matching is partial but spelling counts. |
| Everything is slow | Real browsers are heavy. Reduce parallel users, or increase Docker Desktop's memory (Settings → Resources). |
| Works on the real site but not via `http://localhost:3000` | Containers can't see your machine's localhost — use `http://host.docker.internal:3000`. |

## What's on the roadmap here

Selenium script import (.side recordings), running steps on Firefox/WebKit,
scheduled regression runs with email alerts, and combining both worlds —
running a browser flow *while* a load test hammers the same site, to see how
the real user experience degrades under pressure. That last one is a feature
testers ask for constantly and very few tools do well.
