# Getting started (no coding experience needed)

This guide assumes you have never used a terminal or written code. Follow it
top to bottom and you will run your first performance test in about 15 minutes.

## What is Loadstar doing, in one paragraph?

A performance test pretends to be many people using a website or API at the
same time. Loadstar creates those pretend people ("virtual users"), points
them at an address you choose, measures how fast the responses come back and
how many fail, and then has Claude (an AI) explain the results in plain
English.

**One rule before anything else: only ever test things you own or have
written permission to test.** Firing load at someone else's website is
illegal in most places. Loadstar has built-in guardrails, but the
responsibility is yours.

---

## Step 1 — Install Docker Desktop (one time)

Docker is a free program that runs Loadstar for you, so you never need to
install databases or programming languages yourself.

1. Go to docker.com and download **Docker Desktop** for your computer
   (Windows or Mac).
2. Install it like any normal app and open it. Wait until it says
   "Docker Desktop is running".

## Step 2 — Open a terminal

The terminal is just a window where you type commands instead of clicking.

- **Windows:** press the Start key, type `powershell`, press Enter.
- **Mac:** press Cmd+Space, type `terminal`, press Enter.

## Step 3 — Start Loadstar

1. Unzip the `loadstar` folder somewhere easy, like your Desktop.
2. In the terminal, move into that folder by typing (then Enter):

   ```
   cd Desktop/loadstar
   ```

   (`cd` means "change directory" — go into a folder.)

3. Create your settings file by copying the example:

   - Mac: `cp .env.example .env`
   - Windows PowerShell: `copy .env.example .env`

4. Start everything:

   ```
   docker compose up --build
   ```

   The first time takes a few minutes — Docker is downloading everything.
   You'll know it's ready when you see `Loadstar listening on :8080`.

5. Open your web browser and go to: **http://localhost:8080**

You should see the Loadstar screen with a blue trace line across the top.

To stop Loadstar later: click in the terminal and press `Ctrl+C`.
To start it again: `docker compose up` (no `--build` needed after the first time).

## Step 4 — Run your first test (safely)

Loadstar ships with a built-in practice website called `demo`, so your first
test hurts nobody.

On the **New test** screen, fill in:

| Field | Type this | What it means |
|---|---|---|
| Test name | `My first test` | Just a label for you |
| Target URL | `http://demo` | The built-in practice site |
| Method | `GET` | "Fetch a page" — the simplest request |
| Test mode | `Load` | Ramp up users, then hold steady |
| Virtual users | `10` | Ten pretend visitors |
| Ramp-up | `5` | Take 5 seconds to reach 10 users |
| Duration | `30` | Run for 30 seconds total |

Click **Save & run test**. You'll be taken to the live report page —
the numbers fill in when the test finishes (about 40 seconds).

## Step 5 — Reading your report

- **Requests** — how many total requests your virtual users made.
- **Throughput (req/s)** — requests handled per second. Higher = better.
- **Error rate** — % of requests that failed. You want this near 0.
- **p95** — the most useful number in performance testing: 95% of requests
  were *faster* than this. If p95 is 300ms, only the slowest 5% took longer.
- The **chart** shows response time (blue) and throughput (green) over the
  test. Red dots mark seconds where errors happened.
- The **AI analysis** card is Claude reading all of the above and telling you
  the verdict, what it noticed, and what to try next. (This appears only if
  you added an `ANTHROPIC_API_KEY` to your `.env` file — see below.)

**Enabling AI analysis:** open the file called `.env` in the loadstar folder
with Notepad (Windows) or TextEdit (Mac), and paste your key after
`ANTHROPIC_API_KEY=`. You can create a key at console.anthropic.com. Restart
Loadstar afterwards (`Ctrl+C`, then `docker compose up`).

---

## Step 6 — Data-driven tests with a CSV file (parameters)

Real users don't all do the same thing — they log in with different
usernames, search different products, open different pages. A CSV file lets
each virtual user pull different data.

### What is a CSV?

A plain text file where the **first line names your columns** and every line
after it is one row of data, separated by commas. You can make one in
Notepad/TextEdit, or in Excel using **File → Save As → CSV**.

Example — save this as `users.csv`:

```
username,password,product_id
alice,Secret123,1001
bob,Hunter456,1002
carol,Passw0rd,1003
```

### How to use it in Loadstar

1. On the New test screen, click **Test data — CSV file** and choose your file.
   Loadstar confirms the rows it loaded and shows your available
   placeholders, e.g. `${username}  ${password}  ${product_id}`.
2. Use those placeholders — the column name wrapped in `${ }` — anywhere in
   the **URL**, **headers**, or **request body**:

   - URL: `https://staging.yoursite.com/products/${product_id}`
   - Body (with method POST):
     ```
     {"user": "${username}", "pass": "${password}"}
     ```
3. Run the test. Virtual user 1 gets row 1 (alice), user 2 gets row 2 (bob),
   and so on. When the rows run out, it loops back to the top.

That's it — this is what testers call **parameterization**, and it's the
difference between a toy test and a realistic one.

### Ideas for CSV files

- A list of your 50 most-visited page URLs (column: `path`, URL: `https://yoursite.com${path}`)
- Test account credentials for login-flow testing
- Product IDs, search terms, or postcodes to vary each request

---

## Step 7 — Email reports after every run

Fill in the SMTP block at the bottom of `.env` and every finished test emails you a
report: the key numbers, Claude's verdict, an **▲ improving / ▼ regressing / ► stable**
trend comparing the last 5 runs, plus "What went well" and "Concerns" lists with numbers.

Easiest setup with a Gmail account:

1. Go to `myaccount.google.com/apppasswords` and create an **App Password**
   (this is a special password just for apps — your real password never goes in a file).
2. In `.env` set: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=you@gmail.com`,
   `SMTP_PASS=<the app password>`, `SMTP_FROM=you@gmail.com`, and
   `REPORT_EMAIL_TO=you@gmail.com`.
3. Restart Loadstar. You can also give any individual test its own recipient with the
   "Email report to" field on the New test screen.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `docker: command not found` | Docker Desktop isn't installed or isn't running. Open the Docker Desktop app first. |
| Page won't load at localhost:8080 | Wait for `Loadstar listening on :8080` in the terminal; check Docker Desktop shows the containers running. |
| "Domain … is not verified" | You targeted a public website. Prove you own it: call the verify step in the README, or test internal/demo targets instead. |
| "Private/loopback targets are blocked" | Open `.env` and make sure `ALLOW_PRIVATE_TARGETS=true`, then restart. |
| Test fails instantly | The target address is probably unreachable from inside Docker. `http://localhost:3000` on your machine is **not** reachable from the worker — use `http://host.docker.internal:3000` instead. |
| Something else | Look at the terminal — the `[worker]` and `[api]` lines usually say exactly what went wrong. |

## Mini-glossary

- **Endpoint / target** — the web address being tested.
- **Virtual user (VU)** — one simulated person hammering your target.
- **Ramp-up** — how gradually users are added (sudden = spike, gradual = realistic morning traffic).
- **Load / stress / spike / soak** — hold steady / keep increasing until it breaks / sudden burst / run for hours to find slow leaks.
- **Latency / response time** — how long one request took, in milliseconds (ms).
- **p95 / p99** — "95% (or 99%) of requests were faster than this." More honest than averages.
- **Throughput** — requests completed per second.
