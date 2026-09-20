# KBH — Kaun Banega Hazaarpati

A two-round KBC-style class quiz. Vite + React on the front, Supabase
(Postgres + Realtime + RPC) on the back, static deploy to Netlify or Vercel.

- **Round 1 — Fastest Finger First:** everyone answers the same questions,
  scored on correctness plus speed.
- **Round 2 — Hot Seat:** the host nominates one participant to play alone.
  The contestant's screen is read-only: they say their answer to the host,
  who locks it in from Round Control.

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

**Upgrading to host-entered hot seat answers (R7):** no schema change — just
re-run `supabase/rpcs.sql`. It adds `host_submit_answer` and makes
`submit_response` refuse direct Round 2 submissions.

**Upgrading to per-question time and prize (R8):** run
`supabase/migration_v5.sql`, then re-run `supabase/rpcs.sql`. Each question
gets an optional **Time (s)** (blank = the round default) and a free-text
**Prize** (e.g. `₹10,000`) shown on the Round 2 screen.

**Upgrading to host-controlled reveal (R9):** run `supabase/migration_v6.sql`,
then re-run `supabase/rpcs.sql`. Locking a hot seat answer in now freezes the
contestant's countdown and shows only the gold lock-in; the verdict appears on
their screen when the host clicks **Reveal answer** in the hot seat panel
(`host_reveal_answer` stamps `responses.revealed_at`). The timer running out no
longer reveals anything by itself.

**Upgrading to Round 2 lifelines (R10):** run `supabase/migration_v7.sql`, then
re-run `supabase/rpcs.sql`. Adds the four lifelines — Audience Poll, 50:50,
Call an Expert, Phone a Friend — played by the host from the **Lifelines**
panel in Round Control, and mirrored onto the contestant's screen:

- **Audience Poll** — the room votes and the host counts it in (see R11
  below).
- **50:50** — the host ticks which two wrong options to strike; those two
  option bars are emptied on the contestant's screen for that question. The
  RPC refuses to strike the correct answer.
- **Call an Expert / Phone a Friend** — freezes the question countdown, puts
  the phone up with its contact list, and runs a separate countdown in its own
  colour. The contact lists live in `lifeline_contacts` and are editable from
  the same panel mid-call; edits reach the contestant's screen live.

Each lifeline is once per run-through. `reset_round` hands all four back, and
there is a **Reset all** button on the panel for undoing a misfire on its own.

**Upgrading to the Audience Poll result (R11):** run `supabase/migration_v8.sql`,
then re-run `supabase/rpcs.sql`. The Audience Poll is no longer an indicator
only. Starting it puts the LIVE banner up while the room votes; the host types
the tally into the **Lifelines** panel, one count per option, and **End poll &
show result** publishes it as the bar chart in the top-right of the
contestant's board (`assets and references/Audience_pole_Display.png`).

The poll holds the question clock the way a call does — nobody can be asked to
think against a running countdown with the room's answer in front of them — so
the chart stays up, and the clock stays frozen, until the host clicks **Hide &
resume clock**. The countdown then picks up from exactly where it froze.

- Counts go in, not percentages — the chart works out the split (and makes it
  add up to 100), so one miscounted option can be fixed on its own.
- The console previews the same percentages as you type, and **Update result**
  corrects the chart while it is still on the board.
- While the chart is up the poll's card stays lit and reads **ON SCREEN**, not
  `USED`: it is still holding the contestant's clock.
- Ending the poll with no tally entered is allowed: the banner goes, there is
  no chart, and the clock resumes straight away.

**Upgrading to picking a lifeline (R12):** run `supabase/migration_v9.sql`, then
re-run `supabase/rpcs.sql`. Choosing a lifeline and playing it are two separate
beats of the show, and **Pick** is the first one: the contestant names 50:50,
the host picks it, and the medallion comes up on the crossing point of the
option rows (`assets and references/Chosen_lifeline_display.png`) before a
single option has been struck. The host then plays it as usual.

- **Pick** is on 50:50, Call an Expert and Phone a Friend. The Audience Poll
  has none — starting it is already the announcement.
- One pick at a time: the board has one medallion, so picking a second moves
  the badge. A contestant playing 50:50 and then a phone call just picks twice.
- A picked lifeline reads **PICKED** on its card; tapping the pill again clears
  the pick. A pick belongs to the question it was made on and goes with it.
- A lifeline that is actually running still wins the medallion, so announcing
  the next one mid-call cannot pull the badge off the call.

**The pick stops the clock (R13):** no schema change and no migration — this is
the contestant's screen reading the same rows differently. A contestant who has
said "50:50" has stopped thinking about the question and started waiting on the
host, who still has to read two options off the console or dial a number.
Running the countdown through that charges them for the host's setup time, so
the pick freezes it and the lifeline finishing starts it again:

- **50:50** — the strike is what hands the clock back. Two bars go empty, there
  is something new to think about, and the countdown picks up where it froze.
- **Call an Expert / Phone a Friend** — the call's *own* clock ending is what
  hands it back, not the host pressing End. The phone comes down at the same
  moment, because a countdown running behind a handset the contestant cannot
  read the question through is time they cannot use. **End call** is now for
  hanging up early, and for handing the lifeline row back afterwards.
- **Audience Poll** — unchanged, and not part of this: it is never picked, and
  it already holds the clock from going live until the chart is hidden (R11).

The contestant's board says which it is. A lifeline that is running reads
**● LIVE**; one the host has only picked reads **● PICKED** with *your clock is
paused* — a frozen countdown with nothing on screen to explain it reads as a
fault. A call whose time has run out while the host has not yet ended the row
reads **● TIME UP**, and says the clock is running again, because it is.

**Upgrading to the prize ladder (R14):** run `supabase/migration_v10.sql`. No
RPC change. Adds the money tree from the show (`assets and references/
Price_list_display.png`) — every rung of the run, cheapest at the bottom, with
the small set of lifelines above it.

The contestant opens it from **Prize ladder**, on the same line as the prize
bar, and it slides in over the board. Three things are marked on it and nothing
else: the rung being played (gold and filled), the rungs already climbed (gold
text), and the guaranteed rungs (white, ✦). The lifelines at its head are the
same medallions as the rail under the question and carry the same four states,
so a contestant weighing whether to walk can see the money left and the
lifelines left in one glance. A new question puts the board back — the
countdown starts on that beat, and a panel left open over the question is time
they cannot use.

The host sets it up in the **Prize ladder** panel in Round Control, which —
unlike the Lifelines panel — is open whether or not the round is live, because
the ladder is drawn up before the show:

- **Stages** is how many rungs the run has. Raising it adds blank rungs on top
  of the ladder to be priced; lowering it takes them off the top, which is the
  end a shortened ladder loses. Unpriced rungs are counted on the panel header
  so none reaches the contestant's screen blank.
- Each rung's price is free text, exactly like a question's prize — `₹10,000`
  and `7 Crore` are both fine. Saved on blur, and it reaches an already-open
  ladder through realtime.
- **✦** marks a guaranteed rung.
- Removing a rung from the middle closes the gap behind it: `level` is the
  rung's position in the climb, so the ladder is renumbered rather than left
  with a hole in it.

The ladder is its own table rather than a read of `questions.prize`: the host
sets how long the run is and what it pays independently of the question list,
and a rung exists whether or not a question has been written for it yet. The
per-question **Prize** field is unchanged and still drives the money bar on the
board.

**Upgrading to question tiers (R16):** run `supabase/migration_v11.sql`. No RPC
change. Round 2 used to be a queue — the host served question 1, then 2, then 3,
and the run was whatever order the list happened to be in, one question per rung.
A question now carries `ladder_level`, the rung it is played for, and **several
questions can name the same rung**: a pool per tier that the host picks from
live, instead of a fixed script. The rest of that tier's pool is simply never
asked.

The migration backfills by position, so a database upgrading to it plays exactly
the run it played before — question N keeps rung N — until the host starts
filing questions onto rungs deliberately.

Set a question's rung in the **Questions** tab: Round 2 questions get a **Prize
rung** picker listing the ladder's own rungs, and the list marks an unfiled one
`no rung`.

**CSV import** takes a `ladder_level` column (also spelled `rung`, `tier`, or
`level`), and the downloadable template shows two questions sharing one rung —
the thing about the column you cannot guess from its name. A bulk import is the
one moment a whole run gets filed onto the ladder at once, so the preview says
where it lands rather than only listing rows:

- **Where this lands on the prize ladder** — a pill per rung with how many
  questions it already holds and how many this file adds. A rung that will
  still have nothing to ask is dashed and named, because the run steps over it
  and it pays nothing.
- A rung the file uses that is **above the top of the ladder** is called out:
  those questions import off the ladder and are never asked. Lengthen the
  ladder, or renumber the file.
- Complaints now come in two kinds. **Errors** still block the whole import
  until the file is fixed. **Warnings** do not: the question imports, but not
  the way you probably meant. A `ladder_level` on a Round 1 row (ignored —
  Round 1 has no ladder), a blank rung cell, or a pre-R16 file with no rung
  column at all, whose Round 2 questions all land off the ladder. Identical
  warnings collapse into one line with a count and line numbers.

Importing against a database that has not run the migration still works: the
importer probes for the column, drops the rungs, and says so in the toast
rather than failing the whole file.

Round 2's **question console** is then grouped by rung, highest first, like the
money tree beside it:

- A strip of rung numbers across the top is the climb at a glance — behind the
  run, on it, or still locked.
- Only the rung the run is standing on is open for serving. **The run stands on
  the lowest rung nobody has answered yet**, so answering one of a tier's
  questions is what opens the tier above it. Nothing here asks whether the
  answer was *right*: a wrong answer ends the run (R15), and a run that is over
  does not need a next tier.
- Serving from any other tier still works and asks first — a question that turns
  out to be broken, or a rung the host wants to re-ask. A tier gate that cannot
  be overridden is a gate that strands a show.
- A rung with **no questions filed for it** is stepped over rather than treated
  as a wall, and is called out above the list. Otherwise a rung nobody has
  written for yet stops the show dead.
- Questions with no rung, or a rung a shortened ladder has since lost, are
  listed last under **Not on the ladder**. Listed, not dropped: a question that
  has silently vanished from the console is worse than one out of place.

Tiers want **manual mode**, and the console says so when it is off: auto-advance
moves the round on by `order_index`, which with a pool per rung is the next
question in the *bank*, not the next rung. Serving anything by hand turns manual
mode on anyway.

On the contestant's side the rung is now the question's own, not its place in
the queue: the board counts *"Question 3 of 10"* against the ladder's height
rather than the bank's size, and the ladder highlights the rung being played, so
a host picking a different question from the same tier does not move the
contestant. What they take home is unchanged in spirit — the last guaranteed
rung they passed — but a rung is cleared by *any* question played for it being
answered correctly (`round2/checkpoints.js`).

**Sound effects (R17):** no migration — this is front-end only, over a
Supabase Realtime channel (`kbh-sfx`) that needs no table. The sound plays on
**the contestant's Round 2 screen**, the one the room can see, not on the
host's machine. The nine clips are in `src/assets/sounds/` (copied, with clean
names, from `assets and references/sound_effects/`).

- **Enable it on the contestant's screen.** Browsers will not play audio on a
  page nobody has touched, so the Round 2 screen has an **Enable sound** pill in
  its header (and on the waiting screen). Click it once per page load — a refresh
  turns sound off again. Only a screen that has been enabled ever plays, which is
  also what stops every other participant with the page open from sounding off.
- **Automatic cues**, driven by what the board already shows:

  | Moment | Sound |
  |---|---|
  | Question goes live | question sting, then a suspense bed (2 or 3, picked at random, never the same twice running) looping under the clock. A staged question (R18) gets the sting alone; the bed starts when the host reveals the options |
  | Lifeline picked / Audience Poll chart up | the bed pauses with the clock and resumes with it |
  | Audience Poll live | poll suspense (suspense 1) |
  | Host locks the answer | lock sting, then the after-lock suspense until the reveal |
  | Host reveals | right-answer or wrong-answer |
  | Timer runs out, nothing locked | the bed stops; no buzzer |

  A refresh mid-question does not replay the moment it missed: the board
  starts quiet and the next cue plays normally.
- **Sound Board** — the **🔊 Sounds** button in the admin top bar opens a dock
  down the right side that stays put on any tab. Every clip has a button there
  (the **KBC intro** has nothing else — no automatic cue), plus **Stop all**. A
  press plays over whatever is running; the show's own cues take over again at
  the next lock-in or serve. The dock's status line says whether a speaker is
  actually listening, so a muted contestant screen shows up before the show does.

**Staged option reveal (R18):** run `supabase/migration_v12.sql`, then re-run
`supabase/rpcs.sql`. Up to the first checkpoint a question goes up with its
options and clock together, as before. Above it, the question goes up **alone**:
the contestant sees only the question, the host reads it out, and the four
options and the countdown appear together when the host clicks **Reveal
options**.

- **Which questions:** every rung above the first guaranteed (✦) rung on the
  prize ladder is staged by default; that rung and the ones below it are not.
  Questions the rule will stage carry a **staged** tag in the console.
- **Override:** the **Options** control in the question console's toolbar —
  *Auto* (the rule), *Staged* or *Together* — forces the **next serve only**,
  then falls back to *Auto*, so a rehearsal override cannot be left on into
  the show.
- **Reveal options** is the gold button in the hot seat panel, shown while the
  live question is waiting on its options. Until it is clicked the four answer
  buttons are off (`host_submit_answer` refuses too: *Reveal the options
  first*).
- **The clock** starts when the options land, on the contestant's own device,
  and the response time behind an answer is measured from the same moment — the
  reading time is not taken out of their answer window.
- **Sound:** the question sting plays when the question goes up, and the
  suspense bed starts with the clock when the options are released. The sting
  is left to finish rather than being cut.
- Serving, advancing, starting and resetting all clear the staged state, so it
  can never outlive its question. A database that has not run the migration
  serves every question the old way, and the console says so.

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
4. In the Round 2 hot seat, **Prize ladder** (next to the prize bar) opens the
   money tree: what every rung of the run pays, which one is being played, and
   which lifelines are still in hand. It closes itself when the host serves the
   next question.

### Host

Sign in at `/` on the **Admin** tab (or `/admin/login`).

- **Live Dashboard** — Round 1 leaderboard, updating live. Each row has a
  **Nominate** button that sends that participant to the Round 2 hot seat.
- **Questions** — add / edit / delete / reorder, per round.
- **Participants** — CSV import, network-check status, nominate, reset PIN,
  delete.
- **Round Control** — start / end / reset each round, pick the hot seat, and the
  **Question Console**. While Round 2 is live, a **Lock in answer** panel shows
  the current question with A–D buttons — click one, then click it again to
  confirm; the contestant's screen turns green/red instantly. Re-serve with
  *Clear answers on serve* to replay a question.
  - **Serve** any question at any time, in any order.
  - **Manual mode** (turned on automatically the first time you serve) stops
    participant clients auto-advancing, so nothing moves until you say so.
    Toggle it back to **Auto-advance** to let the round run itself.
  - **Clear answers on serve** re-opens a question that has already been
    answered, so you can replay it.
  - **Reset & clear responses** makes a round re-runnable — without clearing,
    participants stay locked out of questions they have already answered.
  - **Prize ladder** — how many rungs the Round 2 run has, what each pays, and
    which are guaranteed. Open whether or not the round is live.

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
