# KBH — Outstanding Issues Audit

> **Status note (v2 refinement pass).** The items marked **[FIXED v2]** below
> were resolved while implementing the six requirements in
> [`docs/REFINEMENT-PLAN.md`](docs/REFINEMENT-PLAN.md) — each was a blocker for
> one of them. Everything unmarked is still open, and the plan document explains
> which of those were deferred on purpose and why. Database changes ship as
> `supabase/migration_v2.sql` plus the rewritten `supabase/rpcs.sql`.


Audit of the repo against `instructions.md` (v1 MVP spec), covering every file in `src/`, `supabase/`, and the build config. Grouped by severity. Each entry names the file, the concrete failure, and what the spec expects.

**Headline:** the two round engines work in the happy path, but the round cannot be re-run without manual DB surgery, question edits silently desynchronise client and server, response timing is computed with the wrong Postgres function, and every correct answer is readable by participants before they answer. Module 2 (Admin) is the least complete module — it is marked 🔲 in `instructions.md` and that is accurate. Module 6 (Shared UI) has not been started.

---

## 1. Blockers — the app will misbehave during a live run

### 1.1 [FIXED v2] `response_time_ms` uses the wrong `EXTRACT` field and wraps every 60 seconds
`supabase/rpcs.sql:69`

```sql
v_response_time := EXTRACT(MILLISECONDS FROM (now() - v_round_state.question_started_at))::INT;
```

`EXTRACT(MILLISECONDS FROM interval)` returns **only the seconds field × 1000**, not the total interval. An answer submitted 65 s after `question_started_at` records `5000` ms, not `65000`. This is exploitable: because questions only advance when a client is connected (see 1.2), a question can sit live for minutes, and a participant answering at 1 m 3 s scores as if they answered in 3 s.

Fix: `EXTRACT(EPOCH FROM (now() - v_round_state.question_started_at)) * 1000`.

### 1.2 [FIXED v2] Question advance depends entirely on a connected participant; admin has no manual control
`src/modules/round1/Round1Engine.jsx:241`, `src/modules/round2/Round2Engine.jsx:211`, `src/modules/admin/RoundControl.jsx`

`advance_question` is only ever called from a participant's `TimerRing` `onTimeUp` handler. The spec (Module 4) accepts this design, but there is no fallback:

- If every participant closes the tab / loses network, the round freezes on the current question forever. Nothing in `RoundControl` can push it forward — it only exposes Start, End (`completed`), and Reset to Inactive.
- Round 2 is worse: exactly one participant is the hot seat, so a single dropped connection stalls the round with no recovery path.

Add a "Next Question" button in `RoundControl` calling `advance_question(round)`, and/or a `pg_cron` watchdog.

### 1.3 [FIXED v2] A round cannot be re-run — stale responses permanently block resubmission
`src/modules/admin/RoundControl.jsx:64-86`, `supabase/rpcs.sql:56-62`

`setRoundStatus(round, 'inactive')` writes only `{ status: 'inactive' }`; `current_question_index` is left where it was. Restarting via `start_round` resets the index to 0, but the `responses` rows from the previous run survive, and `submit_response` rejects with `Already answered` on the `UNIQUE (participant_id, question_id)` constraint.

Net effect: after one practice run, every participant is locked out of every question until someone manually deletes from `responses` in the Supabase console. There is no "Reset Round" / "Clear Responses" RPC or admin action anywhere in the codebase.

### 1.4 [FIXED v2] Client indexes questions by array position; server matches by `order_index`
`src/modules/round1/Round1Engine.jsx:133,173,258`, `src/modules/round2/Round2Engine.jsx:115,149,225` vs `supabase/rpcs.sql:44-48`

The client does `questions[roundState.current_question_index]` (array position after `.order('order_index')`). The server does `WHERE order_index = v_round_state.current_question_index`.

These agree only while `order_index` is a gapless 0-based sequence. It stops being one as soon as a question is deleted: `deleteQuestion` (`QuestionManager.jsx:80`) removes the row and never renumbers the survivors. Delete Q2 of 5 and `order_index` becomes `0,2,3,4`; the client renders index 1 → `order_index=2`, the server looks for `order_index=1` → not found → every submission is rejected with `Question is not current`.

Pick one addressing scheme. Cleanest: have the client resolve the current question with `questions.find(q => q.order_index === current_question_index)`, and additionally renumber `order_index` on delete.

### 1.5 [PARTIAL v2] Correct answers are shipped to every participant before they answer

**v2:** `pin_hash` is now revoked from the `anon` role (`REVOKE SELECT (pin_hash)
ON participants FROM anon`), closing the bcrypt-hash exposure. The
`correct_option` pre-fetch and the readable `responses` stream are unchanged and
still open.
`src/modules/round1/Round1Engine.jsx:47-50`, `supabase/schema.sql:86-87`

The engines run `supabase.from('questions').select('*')` for the whole round on mount, and RLS policy `Anon read questions FOR SELECT USING (true)` allows it. `correct_option` for all 5 questions is sitting in the network tab / React state before question 1 goes live. `QuestionCard` needs `correct_option` locally only to paint the reveal — the RPC already returns `is_correct`.

Two compounding leaks in the same area:

- **`Anon read responses USING (true)`** (`schema.sql:92-93`) plus `responses` in the realtime publication means any participant can subscribe to the live response stream and read other participants' `selected_option` and `is_correct` in real time.
- **`Anon read participants USING (true)`** (`schema.sql:90-91`) exposes the whole `participants` table **including `pin_hash`** to anonymous clients. bcrypt hashes of 4-digit PINs are trivially brute-forced offline.

The spec puts "anti-cheat beyond server-timestamped scoring" out of scope for v1, but this is a different class of problem: it is a data-exposure hole, not a cleverness gap. At minimum, restrict the anon `participants` policy to non-secret columns (a view or column-level grants), and serve questions without `correct_option` until the question closes.

### 1.6 [FIXED v2] `SECURITY DEFINER` functions have no `SET search_path`
`supabase/rpcs.sql` — all four functions

None of `submit_response`, `advance_question`, `claim_or_verify_pin`, `start_round` pin `search_path`. Two consequences:

- **Security:** a mutable `search_path` on a `SECURITY DEFINER` function is the standard Postgres privilege-escalation vector, and Supabase's own linter flags it.
- **Functional:** `crypt()` / `gen_salt()` live in the `extensions` schema on Supabase, not `public`. `claim_or_verify_pin` resolves them only because the caller's `search_path` happens to include `extensions`. Under a different role or a changed default it fails at runtime with `function crypt(text, text) does not exist`.

Add `SET search_path = public, extensions` to each function.

### 1.7 [FIXED v2] `submit_response` crashes when `question_started_at` is NULL
`supabase/rpcs.sql:69`, `supabase/schema.sql:57`

`question_started_at` is nullable and `responses.response_time_ms` is `NOT NULL`. If `round_state.status` is `'active'` while `question_started_at` is NULL, `now() - NULL` is NULL and the INSERT raises a not-null violation — the participant sees a raw Postgres error, not a handled response.

`walkthrough.md` records this exact failure being hit and worked around by routing the admin start through `start_round`, but the RPC itself was never hardened. Any other path that sets `status='active'` (the Reset flow, a manual SQL edit, a future admin feature) reintroduces it. Guard explicitly and return `{success: false, error: ...}`.

---

## 2. Major — spec requirements not implemented

### 2.1 Live monitoring dashboard covers Round 1 only
`src/modules/admin/LiveDashboard.jsx`

Every query and subscription is hardcoded to `round = 1` (lines 20, 34, 51, 55, 66). There is no Round 2 view at all — during the hot seat the admin is blind. Module 2 asks for a live monitoring dashboard without scoping it to one round.

### 2.2 Dashboard omits participants who haven't answered
`src/modules/admin/LiveDashboard.jsx:72-101`

The leaderboard is built by iterating `responses`, so a participant only appears once they have answered at least one question. Module 2 specifies "table of participants — per-question **answered/pending** status". The pending column only works for people who already answered something else; someone who has answered nothing is invisible rather than shown as all-pending. Seed the map from `participants`, not from `responses`.

### 2.3 Module 6 (Shared UI) not started
`src/modules/shared/styles.css`, all component files

`instructions.md` marks this TODO and it is. The design tokens and a handful of primitives (`.btn`, `.card`, `.form-input`, `.pill`, `.badge`, `.data-table`, `.toast`) were extracted, but the actual round/admin styling lives in ~2,000 lines of per-component `<style>{`...`}</style>` blocks injected into the document. Consequences:

- Rules are global despite being co-located, so they leak across components and load order decides the winner.
- `round1/TimerRing.jsx` and `round2/TimerRing.jsx` are near-identical files whose only real difference is the colour ramp and a `r2-` class prefix; same for the two `QuestionCard.jsx` and the two engines. This is the opposite of the spec's "reuse Module 4's mechanics, parameterized by round" (Module 5).
- The source the spec says to extract from — the existing static Round 1 HTML/CSS, referenced as `round1-fastest-finger-first.html` in `styles.css:3` — is not in the repo, so the extraction cannot be verified against the original.

### 2.4 [FIXED v2] No SPA rewrite config for the stated deploy targets
repo root

Deploy is "static build to Netlify or Vercel" and the app uses `BrowserRouter` with `/round/1`, `/round/2`, `/admin/login`. There is no `netlify.toml`, `vercel.json`, or `public/_redirects`. A participant who reloads on `/round/1` — the exact "basic page reload picking up current state" the spec keeps in scope — gets a 404 from the CDN.

### 2.5 Participants can't reach their results after a round ends
`src/modules/participant/ParticipantHome.jsx:119,140,294-304`

`canEnter` is `status === 'active'`, so once the round flips to `completed` the card button is disabled and reads "Completed". `Round1Results` / `Round2Results` render only from inside the engine, which is now unreachable from the home screen. Anyone who navigated away — or joined late — can never see their score, rank, or the leaderboard. Allow entry when `status === 'completed'`.

### 2.6 [FIXED v2] No PIN reset for participants
`src/modules/admin/ParticipantImport.jsx`

`claim_or_verify_pin` permanently binds the first PIN entered for a roll number. The admin table shows Claimed/Unclaimed but offers only Delete. A student who forgets their PIN — or a roll number claimed by the wrong person — can only be fixed by deleting the participant (which fails, see 3.1) or editing `pin_hash` by hand in the console. Add a "Reset PIN" action that nulls `pin_hash`.

### 2.7 [FIXED v2] No question-count or empty-round guard
`supabase/rpcs.sql:110-118`, `src/modules/admin/RoundControl.jsx`

Starting a round with zero questions for that round leaves `v_total_questions = 0`; `advance_question` then evaluates `0 + 1 >= 0` and immediately marks the round `completed`, while participants sit on a "Waiting for next question…" screen. `RoundControl` doesn't check the question count before enabling Start.

---

## 3. Moderate — correctness and data-integrity defects

### 3.1 [FIXED v2] Deleting a participant or question fails once responses exist
`supabase/schema.sql:47-49`, `ParticipantImport.jsx:92`, `QuestionManager.jsx:80`

`responses.participant_id` and `responses.question_id` are plain `REFERENCES` with no `ON DELETE` behaviour, and `round_state.active_participant_id` likewise. Both admin delete buttons therefore throw a foreign-key violation as soon as the person/question has any response — surfaced as a generic "Failed to delete" toast with no explanation. Decide on `ON DELETE CASCADE` (responses die with the row) or `ON DELETE RESTRICT` plus a clear message.

### 3.2 `advance_question` is not actually atomic under concurrency
`supabase/rpcs.sql:110-165`

This is the item `instructions.md` explicitly asks to be flagged. The `UPDATE ... WHERE current_question_index = v_current_index` clause is sound, but the read at line 113 is a plain `SELECT` with no `FOR UPDATE`. Two clients firing simultaneously both read index `N`; the first commits `N+1`, the second's UPDATE matches zero rows and returns the "already advanced" no-op. So the *state* is safe.

The real gap is the **transition window**: both clients call at `T+2.5 s`, but a client that reconnects and calls at `T+12 s` still reads index `N` (if the first call somehow failed) and advances then — `question_started_at` is set to that client's arrival time, not a fixed schedule. Combined with 1.2, question pacing is a function of who happens to be connected. Consider `SELECT ... FOR UPDATE` for strictness and a guard that refuses to advance if `now() - question_started_at` is far past the question duration.

### 3.3 [PARTIAL v2] Late answers still score full base points

**v2:** `submit_response` now clamps the response time to
`round_state.question_duration_ms`, so time points floor at zero rather than
depending on the client. Base points are still awarded for a late-but-correct
answer — rejecting outright is a scoring policy call that needs sign-off.
`supabase/rpcs.sql:83-88`

`GREATEST(0, 10000 - v_response_time)` floors the *time* bonus at zero, but `points_awarded = base_points + time_points` still awards the full `base_points` for a correct answer submitted at t = 30 s. The client hides this by disabling the pills at zero, but the RPC is the security boundary and a crafted call scores freely. Reject submissions past the question duration server-side.

### 3.4 [FIXED v2] The 10-second duration is hardcoded in three places
`Round1Engine.jsx` (`durationMs={10000}`), `Round2Engine.jsx` (same), `rpcs.sql:85` (the `10000` in the formula)

The spec asks for independent, swappable modules with the scoring formula as the one deliberately fixed piece. Question duration isn't in that exemption. Changing 10 s to 15 s currently means editing two components and one SQL literal, and the three can silently drift apart. Put it in `round_state` or a config table.

### 3.5 CSV import overwrites existing names with NULL
`src/modules/admin/ParticipantImport.jsx:80-84`

`upsert(csvPreview, { onConflict: 'roll_no' })` with rows whose `name` is `null` (the roll-no-only CSV format the spec describes) will null out names already stored for those roll numbers. The UI text even promises the opposite: "Existing roll numbers will be updated with new name values." Either omit `name` from the payload when it's absent, or use `ignoreDuplicates: true`.

`instructions.md` flags "exact CSV column format" as an open question — the implementation settled on headers `roll_no` (required) / `name` (optional), case-insensitive. Worth confirming that's the intended contract, since the parser hard-fails without a `roll_no` header.

### 3.6 CSV parser doesn't handle quoted fields
`src/modules/admin/ParticipantImport.jsx:41-70`

Naive `split('\n')` then `split(',')`. A name containing a comma (`"Rao, Harini"`) shifts every column after it and silently imports garbage. `\r\n` happens to survive because of the `.trim()` on each cell, but quoting does not.

### 3.7 Question reorder is two unguarded writes
`src/modules/admin/QuestionManager.jsx:117-135`

`moveQuestion` fires two sequential `.update()` calls with no transaction and no error handling. If the second fails, two questions end up sharing an `order_index` — at which point `submit_response`'s `LIMIT 1` lookup (`rpcs.sql:48`) picks one arbitrarily and the round breaks in a way that is very hard to diagnose. Move this into an RPC.

### 3.8 [FIXED v2] `OptionEditor` is redefined on every render — inputs lose focus per keystroke
`src/modules/admin/QuestionManager.jsx:141` (used at 232, 311)

Declared inside the `QuestionManager` function body, so React sees a new component type each render and remounts the subtree. Typing into an option field loses focus after every character. Confirmed by oxlint: `react(static-components)` at `QuestionManager.jsx:232:16`. Hoist it to module scope.

### 3.9 [FIXED v2] Advance timer isn't cancelled on unmount
`Round1Engine.jsx:241`, `Round2Engine.jsx:211`

The 2.5 s `setTimeout` in `handleTimeUp` has no cleanup. Navigate away during the transition and the RPC still fires from a dead component. Harmless today only because `advance_question` is idempotent. Store the id in a ref and clear it.

### 3.10 [PARTIAL v2] Realtime handlers assume `payload.new` exists

**v2:** `RoundControl`, `LiveDashboard` and the new admin `participants`
subscription now guard `payload.new` before reading it. Any handler added since
should do the same.
`RoundControl.jsx:24-25`, `ParticipantHome.jsx:46`, `LiveDashboard.jsx:34`

All subscribe with `event: '*'` or `'UPDATE'` and read `payload.new.round` unguarded. On a DELETE event `payload.new` is `{}` (or undefined), throwing inside the subscription callback. `ParticipantHome` guards with `updated && updated.round`; `RoundControl` does not.

### 3.11 [PARTIAL v2] `schema.sql` is not re-runnable

**v2:** indexes use `IF NOT EXISTS`, policies are dropped before creation, and
the publication `ALTER`s are wrapped in exception blocks — `schema.sql` re-runs
cleanly now. `seed.sql` still has no `ON CONFLICT` on its question inserts and
will duplicate them on a second run.
`supabase/schema.sql`

`CREATE TABLE IF NOT EXISTS` implies the file is meant to be idempotent, but `CREATE INDEX` (lines 18, 30, 67-69), `CREATE POLICY` (74-93), and `ALTER PUBLICATION ... ADD TABLE` (96-97) all have no `IF NOT EXISTS` / `DROP ... IF EXISTS` guard. Second run aborts partway. Same for `seed.sql`'s question inserts, which have no `ON CONFLICT` and will duplicate all 10 questions on a re-run — which then breaks `order_index` uniqueness assumptions (see 1.4).

### 3.12 `auth.role()` in RLS policies
`supabase/schema.sql:74-82`

`auth.role()` is deprecated on Supabase. The modern equivalent is `TO authenticated` on the policy, or `(SELECT auth.uid()) IS NOT NULL`. Also worth noting: `FOR ALL USING (auth.role() = 'authenticated')` grants *any* signed-in user full write access to every table — fine for the single hardcoded admin the spec describes, but it means the admin account is the only thing standing between a participant sign-up and total control. Since participants don't use Supabase Auth at all, this holds for v1; document it so it isn't forgotten when auth expands.

---

## 4. Minor — hygiene, dead code, polish

### 4.1 `.env` with live credentials is committed to git
`.env`, `.gitignore`

`git ls-files` shows `.env` is tracked, and `.gitignore` has no `.env` rule (only `*.local`). `.env` is byte-identical to `.env.example` — the real project URL and anon key are in both. The anon key is publishable by design, but committing `.env` is the habit that leaks the service-role key next. Add `.env` to `.gitignore` and `git rm --cached .env`.

### 4.2 Vite template leftovers still shipping
`src/index.css`, `src/App.css`, `src/assets/`, `public/icons.svg`, `README.md`, `requirements.txt`

- `src/index.css` is imported by `main.jsx:3` and is still the stock Vite template: a **light-mode** `:root` palette (`--bg: #fff`, `--accent: #aa3bff`), plus `body`, `#root`, `h1`, `h2`, `p`, `code`, `.counter` rules that fight `shared/styles.css` for the same selectors. It should be deleted or reduced to a reset.
- `src/App.css` (184 lines) is imported by nothing.
- `src/assets/hero.png`, `react.svg`, `vite.svg`, `public/icons.svg` are referenced nowhere.
- `README.md` is still the Vite boilerplate — no setup, env, or SQL-run instructions for a project whose entire backend is three SQL files that must be run in order.
- `requirements.txt` is a stub explaining that this is not a Python project.

### 4.3 `badge--warning` is never defined
`src/modules/round2/Round2Engine.jsx:314`

The class doesn't exist in `shared/styles.css` or any `<style>` block; the LIVE badge only renders correctly because of an inline `style` override on the same element. Add the class or drop it.

### 4.4 Barrel exports are inconsistent
`src/modules/round2/index.js`

One line exporting only `Round2Engine`, versus round1's five exports with a doc comment and participant's documented barrel. The round2 `QuestionCard`, `TimerRing`, and `Round2Results` aren't exported at all. Cosmetic, but the spec's "independent, swappable modules" framing makes the module boundary worth keeping uniform.

### 4.5 Admin panel has no route structure
`src/App.jsx:74-84`, `src/modules/admin/AdminLayout.jsx:16`

`/admin/*` renders `AdminLayout`, which switches tabs from `useState`. Tabs aren't URL-addressable, browser back doesn't move between them, and a reload always lands on Live Dashboard. There is also no link from the admin panel back to the participant view.

### 4.6 [FIXED v2] No catch-all route
`src/App.jsx:55-105`

Any unmatched path renders an empty `<Routes>` — a blank white page, not a 404.

### 4.7 [FIXED v2] Dead code in `ParticipantLogin`
`src/modules/participant/ParticipantLogin.jsx:38-43`

The mount effect calls `onLoginSuccess(stored)` if localStorage has a participant, but `App.jsx:26` already initialises state from `getStoredParticipant()`, so `ParticipantLogin` never renders when a participant is stored. The effect can never fire.

### 4.8 [FIXED v2] Success flash resets `loading` before it navigates
`src/modules/participant/ParticipantLogin.jsx:96-103`

`finally { setLoading(false) }` runs immediately while a 1200 ms `setTimeout` waits to call `onLoginSuccess`. The timeout isn't cleared on unmount either.

### 4.9 Stored participant is never revalidated
`src/modules/participant/ParticipantLogin.jsx:16-24`

`getStoredParticipant()` returns whatever JSON is in localStorage with no shape check beyond `participant_id` being truthy and no server check that the id still exists. If the admin deletes and re-imports participants, stale clients hold a dangling UUID and every `submit_response` fails at the FK.

### 4.10 Lint warnings
`npx oxlint` — 20 warnings, 0 errors

Beyond 3.8 (`static-components`) and the `react(immutability)` pattern that appears in five files, the mechanical ones: unused `useCallback` import (`round1/TimerRing.jsx:1`), unused catch params (`AdminLogin.jsx:29`, `ParticipantLogin.jsx:99`), unused `isCompleted` (`RoundControl.jsx:104`), and missing `useEffect` deps in both Results components.

---

## 5. Open questions from `instructions.md`, still open

The spec's own "flag back to me" list — none of these has been resolved in code or in a follow-up note:

1. **CSV column format** — implementation assumed `roll_no` / `name` headers (see 3.5). Needs confirming.
2. **More than 4 options / multiple correct answers** — `options` is `jsonb` so the schema is flexible, but `OPTION_LABELS = ['A','B','C','D']` is hardcoded in four components and `QuestionManager`'s editor is fixed at exactly 4 rows. A 5-option question would render a blank label and be uneditable.
3. **Concurrent `advance_question`** — analysed in 3.2. The atomic UPDATE holds; the pacing model around it doesn't.

One more the spec should decide: the **default scoring formula was flagged "confirm/adjust before launch"** and never confirmed. As written, a correct answer at t=0 scores `2 × base_points` and a correct answer at t≥10 s scores `1 × base_points` — a 2× spread. That's a deliberate choice, but worth a conscious sign-off given it's the single thing determining who reaches the hot seat.

---

## Suggested fix order

Roughly dependency-ordered, blockers first:

1. `EXTRACT(EPOCH …)` fix + `SET search_path` + NULL guard on all RPCs (1.1, 1.6, 1.7) — one pass over `rpcs.sql`
2. Reset-round RPC that clears responses and resets the index; wire into `RoundControl` (1.3)
3. Resolve current question by `order_index` on the client; renumber on delete (1.4)
4. Manual "Next Question" control in `RoundControl` (1.2)
5. Tighten the `participants` anon RLS policy off `pin_hash`; withhold `correct_option` until reveal (1.5)
6. SPA rewrite file for the deploy target (2.4)
7. `ON DELETE` behaviour on the three FKs (3.1)
8. Let participants re-enter completed rounds for results (2.5)
9. Round 2 monitoring + all-participants rows in `LiveDashboard` (2.1, 2.2)
10. Everything in §4
