# KBH — Kaun Banega Hazaarpati

A two-round KBC-style class quiz. Vite + React on the front, Supabase
(Postgres + Realtime + RPC) on the back, static deploy to Netlify or Vercel.

- **Round 1 — Fastest Finger First:** everyone answers the same questions,
  scored on correctness plus speed.
- **Round 2 — Hot Seat:** the host nominates one participant to play alone.

See [`instructions.md`](instructions.md) for the build spec,
[`docs/REFINEMENT-PLAN.md`](docs/REFINEMENT-PLAN.md) for the v2 design notes,
and [`ISSUES.md`](ISSUES.md) for the outstanding audit.

---

## Setup

### 1. Environment

```bash
cp .env.example .env    # then fill in your Supabase project URL + anon key
npm install
```

`.env` needs:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

### 2. Database

Run these in the Supabase SQL Editor, **in order**.

**Fresh project:**

| # | File | What it does |
|---|------|--------------|
| 1 | `supabase/schema.sql` | tables, indexes, RLS, realtime |
| 2 | `supabase/rpcs.sql` | all RPC functions |
| 3 | `supabase/seed.sql` | sample participants and questions (optional) |

**Existing project already running v1:**

| # | File | What it does |
|---|------|--------------|
| 1 | `supabase/migration_v2.sql` | adds network-check columns, manual mode, question duration, FK cascades |
| 2 | `supabase/rpcs.sql` | replaces every function with the v2 versions |

Both `schema.sql` and `migration_v2.sql` are safe to re-run.

### 3. Admin account

The admin is a single Supabase Auth user. Create it once in the dashboard —
**Authentication → Users → Add user**, with *Auto Confirm User* ticked:

- Email: `admin@gmail.com`
- Password: whatever you set on that user (this project currently uses `8432`)

Nothing in the app hardcodes these credentials — it signs in against whatever
that account is, so if you change the password in the dashboard the app follows.

Supabase enforces a 6-character minimum through the sign-up API, so a shorter
password has to be set from the dashboard rather than through the app. The
dashboard allows it and sign-in works, but the token response carries a
`weak_password` warning; raise the minimum under **Authentication → Providers →
Email**, or use a longer password, if you'd rather not see it.

**A 400 on the Sign In button is one of two things**, and the response body says
which:

- `invalid_credentials` — the email/password don't match that user. Check the
  password on the account under **Authentication → Users**.
- `validation_failed` / *"Refresh token is not valid"* — not a login failure at
  all. It's a stale admin session left in `localStorage` from an earlier run,
  refreshed on page load. `App.jsx` now clears it on first sight; if you hit it
  on an old build, clear the site's local storage once.

### 4. Run

```bash
npm run dev      # http://localhost:5173
npm run build    # static build to dist/
npm run lint     # oxlint
```

---

## How it works during an event

### Participants

1. Open `/`, choose the **Participant** tab, enter roll number + PIN. The first
   PIN entered for a roll number is claimed permanently (the admin can reset it).
2. An **automatic network check** runs: three latency probes plus a realtime
   connection test. Passing sends them straight to Round 1. Failing shows a red
   screen with *Retry* and *Continue anyway* — and paints their name red in the
   admin Participants list, so the host knows who is on a shaky connection.
3. Round 1 waits on the host, then serves questions with a per-question
   countdown.

### Host

Sign in at `/` on the **Admin** tab (or `/admin/login`).

- **Live Dashboard** — Round 1 leaderboard, updating live. Each row has a
  **Nominate** button that sends that participant to the Round 2 hot seat.
- **Questions** — add / edit / delete / reorder, per round.
- **Participants** — CSV import, network-check status, nominate, reset PIN,
  delete.
- **Round Control** — start / end / reset each round, pick the hot seat, and the
  **Question Console**:
  - **Serve** any question at any time, in any order.
  - **Manual mode** (turned on automatically the first time you serve) stops
    participant clients auto-advancing, so nothing moves until you say so.
    Toggle it back to **Auto-advance** to let the round run itself.
  - **Clear answers on serve** re-opens a question that has already been
    answered, so you can replay it.
  - **Reset & clear responses** makes a round re-runnable — without clearing,
    participants stay locked out of questions they have already answered.

---

## Timing model

The per-question countdown is **client-side**. Each participant's timer starts
when the question renders on their own device, and the elapsed time they report
is what gets scored — so a slow realtime push costs nobody any points. The
server clamps the reported time to `round_state.question_duration_ms` (default
10 s) and still owns correctness, duplicate rejection and the points formula.

The trade-off is deliberate and worth knowing: a determined participant could
forge a fast answer. For an in-class quiz that beats punishing people for their
WiFi. See `docs/REFINEMENT-PLAN.md` § R6.

In **auto-advance** mode the first client whose countdown ends advances the
question for everyone 2.5 s later, so a badly lagged participant can still be
cut short even though their own ring showed a full 10 s. **Manual mode** removes
that entirely — nothing moves until you serve the next question — which is why
it is the better way to run a live session.

Scoring, per question:

```
time_points    = base_points * max(0, duration_ms - response_time_ms) / duration_ms
points_awarded = is_correct ? round(base_points + time_points) : 0
```

Ranking is total points, tie-broken by lowest total response time.

---

## Deploy

Static build with SPA rewrites already configured:

- Netlify — `netlify.toml` and `public/_redirects`
- Vercel — `vercel.json`

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the host's environment
settings, then deploy `dist/`.

> `.env` is currently tracked in git (`ISSUES.md` 4.1). The anon key is
> publishable by design, but adding `.env` to `.gitignore` and running
> `git rm --cached .env` is the habit worth keeping before a service-role key
> ever lands in there.
