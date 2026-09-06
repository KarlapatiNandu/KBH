# KBC-Style Class Quiz App — Build Spec (v1 MVP)

## Context

Two-round quiz app for a class:
- **Round 1 — Fastest Finger First**: all participants answer the same questions, synchronized, one at a time, 10s per question. Scores rank participants.
- **Round 2 — Hot Seat**: admin manually selects one participant (based on Round 1 ranking, but final call is manual) to play a second, similarly-timed question set.

Build this as a set of **independent, swappable modules** — I will keep tweaking individual pieces (scoring rules, question flow, UI) after v1 ships, so avoid tightly coupling logic across modules.

## Tech stack (decided)

- **Frontend**: Vite + React (SPA, no SSR needed — this is an internal authenticated tool, not a public/SEO surface)
- **Backend/DB**: Supabase (Postgres + Realtime + RPC functions). No separate backend server — all writes go through Postgres functions (RPCs) for atomicity.
- **Deploy**: static build to Netlify or Vercel.
- **Styling**: reuse the existing static Round 1 HTML/CSS I already have — extract it into shared React components/stylesheet. Do not introduce a new design system or restyle anything.

## Explicitly out of scope for v1

- Reconnect/resume-after-refresh handling beyond a basic page reload picking up current state
- Anti-cheat beyond server-timestamped scoring (see Module 4)
- Multiple admin accounts (single hardcoded admin login is fine)
- Spectator/live view of Hot Seat for non-selected participants (they just see a disabled placeholder)
- Configurable scoring formula (only `base_points` per question is admin-editable; the time-decay formula itself is fixed for v1)

---

## Module 1: Database schema (Supabase/Postgres)

```
participants
  id (uuid, pk)
  roll_no (text, unique, not null)
  name (text, nullable)
  pin_hash (text, nullable)  -- null until claimed on first login
  created_at (timestamptz)

questions
  id (uuid, pk)
  round (int, 1 or 2)
  text (text)
  options (jsonb)            -- e.g. ["A", "B", "C", "D"]
  correct_option (int)       -- index into options
  base_points (int, admin-editable)
  order_index (int)
  created_at (timestamptz)

round_state
  id (uuid, pk)
  round (int, 1 or 2)
  status (text: 'inactive' | 'active' | 'completed')
  current_question_index (int)
  question_started_at (timestamptz)   -- SERVER time the current question was shown
  active_participant_id (uuid, nullable)  -- used only for round 2 (who's in the hot seat)

responses
  id (uuid, pk)
  participant_id (uuid, fk)
  question_id (uuid, fk)
  round (int)
  selected_option (int)
  is_correct (bool)
  response_time_ms (int)     -- computed server-side, NOT from client clock
  points_awarded (int)
  created_at (timestamptz)
  -- unique constraint (participant_id, question_id) to block duplicate submissions
```

RLS: keep it simple for v1 — participants write only through the `submit_response` RPC (below), which validates their participant_id server-side. Admin operations go through the authenticated Supabase Auth session.

---

## Module 2: Admin

- Login: single hardcoded Supabase Auth email/password account.
- **Question management**: add / edit / delete / reorder questions per round. Inline edit of `base_points`.
- **CSV import**: upload a CSV of roll numbers → bulk insert into `participants` (roll_no only; `pin_hash` stays null until the participant claims it).
- **Round 1 control**: a toggle that sets `round_state` (round=1) to `status='active'`, `current_question_index=0`, `question_started_at=now()`. This is what flips Flashcard 1 to active for everyone.
- **Live monitoring dashboard**: table of participants — per-question answered/pending status, running score, sorted by score then total response time. Subscribe to `responses` via Supabase Realtime so it updates live.
- **Round 2 control**: search/filter participants (by roll_no or name), select one, set `round_state` (round=2) `active_participant_id` and `status='active'`.

---

## Module 3: Participant identification

- Landing screen: enter `roll_no` + PIN.
- If `pin_hash` is null for that roll_no → **claim**: whatever PIN they enter is hashed and saved as their PIN.
- If `pin_hash` already exists → compare; reject on mismatch.
- On success, store `participant_id` in localStorage for subsequent requests. No full session/auth needed for v1.

---

## Module 4: Round 1 engine — Fastest Finger First (synchronized)

- Participant client subscribes to `round_state` (round=1) via Supabase Realtime.
- Flashcard 1 becomes active/clickable when `status` flips to `'active'`.
- On entering the round screen, client reads `current_question_index` + `question_started_at`, renders that question, and renders a **local** countdown as `10000 - (Date.now() - question_started_at)` — this is a UX display only, not the scoring source of truth.
- **Answer submission** via RPC `submit_response(participant_id, question_id, selected_option)`:
  - Server computes `response_time_ms = now() - question_started_at` using the **server clock**, not anything the client sends.
  - Server checks `is_correct` against `correct_option`.
  - Rejects if a response already exists for that participant+question, or if `question_id` no longer matches the current `current_question_index`.
- **Advancing questions** via RPC `advance_question(round)`:
  - Atomic conditional update: `UPDATE round_state SET current_question_index = current_question_index + 1, question_started_at = now() WHERE round = $1 AND current_question_index = $2 AND status = 'active'`.
  - Any client can call this once its local countdown hits zero — the atomic `WHERE` clause means only the first caller actually advances the state; later calls are no-ops. This avoids needing a persistent server process on serverless hosting.
  - When index exceeds the question count, set `status = 'completed'`.
- **Scoring** (default formula — confirm/adjust before launch):
  ```
  time_points = base_points * max(0, 10000 - response_time_ms) / 10000
  points_awarded = is_correct ? round(base_points + time_points) : 0
  ```
- Round 1 ranking = total `points_awarded` per participant, tie-broken by lowest total `response_time_ms`. Surface this in the admin dashboard. **Do not auto-advance a winner** — admin manually activates Round 2 for whoever they choose.

---

## Module 5: Round 2 engine — Hot Seat

- Reuses Module 4's realtime + scoring + advance-question mechanics, parameterized by `round=2` and scoped to `active_participant_id`.
- Only the selected participant sees Flashcard 2 as active; everyone else sees it as a disabled card labeled "Hot Seat in progress."
- Same `responses` table, same scoring formula, `round=2`.

---

## Module 6: Shared UI

- Extract the existing static Round 1 HTML/CSS into reusable React components + a shared stylesheet — do not redesign.
- Participant home screen shows two flashcard components, each enabled/disabled based on the corresponding `round_state.status`.

---

## Build order

1. Schema + RPCs (Module 1, with Module 4's `submit_response`/`advance_question` functions) — confirm schema with me before writing any UI against it.
2. Participant identification (Module 3).
3. Round 1 engine end-to-end (Module 4), tested with a fake question set.
4. Admin panel (Module 2).
5. Round 2 engine (Module 5) — should mostly fall out of Module 4 if built generically.
6. Wire in existing styling (Module 6).

---

## Build Progress

### ✅ Module 1: Database Schema — COMPLETE
- `supabase/schema.sql` — all 4 tables (participants, questions, round_state, responses) with RLS + realtime
- `supabase/rpcs.sql` — `submit_response`, `advance_question`, `claim_or_verify_pin`
- `supabase/seed.sql` — 30 participants, 5 R1 questions, 5 R2 questions, round_state rows, ~50 sample responses

### ✅ Module 3: Participant Identification — COMPLETE
- `src/modules/participant/ParticipantLogin.jsx` — roll_no + PIN login, claim-or-verify flow
- `src/modules/participant/ParticipantHome.jsx` — two round flashcards, realtime round_state subscription
- `src/modules/participant/index.js` — barrel exports

### ✅ Module 4: Round 1 Engine — COMPLETE
Files created in `src/modules/round1/`:
- `Round1Engine.jsx` — orchestrator: subscribes to round_state, manages game state machine (loading → waiting → active → transition → completed), handles answer submission via `submit_response` RPC, auto-advance via `advance_question` RPC
- `QuestionCard.jsx` — renders question text + 4 option pills with correct/wrong feedback
- `TimerRing.jsx` — SVG ring countdown synced to server `question_started_at`, calls advance on zero
- `Round1Results.jsx` — post-round results: participant score/rank, per-question breakdown, top-10 leaderboard
- `index.js` — barrel exports

Router integration:
- `App.jsx` updated — added `/round/1` route with participant guard, `ParticipantHomeWithNav` wrapper for navigation

### 🔲 Module 2: Admin Panel — existing components
- `AdminLogin.jsx`, `AdminLayout.jsx`, `QuestionManager.jsx`, `ParticipantImport.jsx`, `RoundControl.jsx`, `LiveDashboard.jsx`

### ✅ Module 5: Round 2 Engine — COMPLETE
Files created in `src/modules/round2/`:
- `Round2Engine.jsx` — orchestrator: restricts access to active participant, handles answer submission via `submit_response` RPC, auto-advance via `advance_question` RPC
- `QuestionCard.jsx` — renders question text + 4 option pills with hot seat styling
- `TimerRing.jsx` — SVG ring countdown synced to server `question_started_at`
- `Round2Results.jsx` — individual results for the hot seat participant
- `index.js` — barrel exports

Router integration:
- `App.jsx` updated — added `/round/2` route

### 🔲 Module 6: Shared UI Polish — TODO

---

## Flag back to me if unclear

- Exact CSV column format for roll_no import
- Whether questions need more than 4 options, or multiple correct answers
- Anything in the atomic advance-question RPC that doesn't hold up under concurrent calls