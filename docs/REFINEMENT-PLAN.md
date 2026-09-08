# KBH — Refinement Plan (v2)

Design notes for the six requirements handed down after the v1 MVP, plus the
`ISSUES.md` entries that had to be fixed to make them work. Written before the
code so the trade-offs are on the record.

---

## R1 — One login page for participants *and* admin

**Today:** `/` renders `ParticipantLogin` (roll_no + PIN → `claim_or_verify_pin`).
Admin lives behind a separate `/admin/login` page reached by a small link, using
Supabase Auth email/password.

**Change:** one `LoginPage` with two tabs — **Participant** (roll no + PIN) and
**Admin** (email + password). Both live at `/`. `/admin/login` still resolves — it
renders the same page with the Admin tab preselected — so old links and the
`Navigate` guards in `App.jsx` keep working.

The two auth mechanisms stay separate underneath: participants are a row in
`participants` + localStorage, admin is a real Supabase Auth session. Nothing
about the security model changes; only the entry point is merged.

Admin account: `admin@gmail.com`, password set on the account itself (currently
`8432`). This is a Supabase Auth user and must be created once in the Supabase
dashboard (Authentication → Users → Add user, with auto-confirm on). Supabase
enforces a 6-character minimum on passwords, so a shorter one has to be set from
the dashboard rather than through a sign-up call — noted in `README.md`. The app
does not hardcode the credentials; it signs in against whatever that account is.

## R2 — Auto network check on participant login, failures flagged red

**Design:** a `NetworkCheck` gate that runs immediately after a successful
participant login, before the participant can reach a round.

Three probes, all client-side:

1. **Latency** — three sequential `network_ping()` RPC round trips, timed with
   `performance.now()`. Records the median.
2. **Realtime** — subscribe to a throwaway Supabase Realtime channel and require
   `SUBSCRIBED` within 8 s. The whole quiz is driven by realtime `round_state`
   pushes, so a client that cannot hold a socket cannot play, no matter how fast
   its HTTP is.
3. **Reliability** — at least 2 of the 3 pings must return at all.

Pass = realtime subscribed **and** at least 2 of 3 pings succeeded **and** median
latency ≤ 2000 ms. Anything else is a fail.

**Storage:** three new columns on `participants` (`network_status`,
`network_checked_at`, `network_latency_ms`) plus `network_detail` for the
human-readable reason. Anonymous clients cannot write to `participants` under
RLS, so the result goes through a new `SECURITY DEFINER` RPC,
`record_network_check`.

**Admin surface:** the Participants tab gets a Network column and renders the
name of anyone whose `network_status = 'failed'` in `--danger-red`, per the
requirement. `participants` is added to the realtime publication so failures
appear as they happen rather than on refresh.

**On failure the participant is not hard-blocked.** They see a red result screen
with **Retry check** (primary) and **Continue anyway** (secondary). Rationale: a
false negative on flaky campus WiFi shouldn't strand a student mid-event, and the
requirement asks for the failure to be *visible to the host*, not for it to be a
gate. Their row stays red either way, so the host can intervene.

## R3 — Passing the check sends the participant to Round 1

On pass, `NetworkCheck` navigates straight to `/round/1`. If the host hasn't
started Round 1 yet, `Round1Engine` already renders its "Waiting for the host…"
screen, which is exactly the right holding state. The Back button still returns
to the home screen with both round cards, so Round 2 stays reachable.

The check runs once per browser session (tracked in `sessionStorage`), not on
every route change — otherwise every navigation would re-ping the server.

## R4 — Manually nominate a participant to the hot seat

"Nominate" is deliberately distinct from "start Round 2":

- **Nominate** sets `round_state(round=2).active_participant_id` and leaves the
  status alone. It is the host saying "you're next" — the nominee's home screen
  lights up their Hot Seat card via the existing realtime subscription.
- **Start** flips the status to `active` and serves question 1.

New RPC `nominate_hotseat(p_participant_id)`. Nominate buttons go in the two
places the host actually looks at: the **Participants** table, and the **Live
Dashboard** leaderboard (where the host is reading Round 1 rankings to decide).
`RoundControl` picks up the nomination through its existing `round_state`
subscription, so all three views agree.

## R5 — Host serves questions manually, live

This is the largest change and it forces two `ISSUES.md` blockers.

**Manual mode.** New `round_state.manual_mode` boolean. When true, participant
clients stop calling `advance_question` on time-up — they show "Time's up,
waiting for the host" and sit still. When false, the existing auto-advance
behaviour is untouched. Serving a question from the console turns manual mode on
automatically, so the host can't be fighting an auto-advance they forgot about.

**Serve.** New RPC `serve_question(p_round, p_question_id, p_clear_responses)`
which sets `current_question_index` to that question's `order_index`, stamps
`question_started_at = now()`, forces `status = 'active'` and `manual_mode = true`.
The optional `p_clear_responses` deletes existing responses for that question so a
question can be replayed — without it, `submit_response` rejects everyone with
"Already answered" (ISSUES 1.3).

**This only works if client and server address questions the same way**
(ISSUES 1.4). Today the client uses `questions[current_question_index]` (array
position) while the server matches `order_index`. Serving an arbitrary question by
`order_index` breaks the moment those disagree. Fix: the client resolves the
current question with `find(q => q.order_index === current_question_index)`, and
`QuestionManager` renumbers `order_index` after a delete.

**Admin UI:** a Question Console inside Round Control, per round — manual-mode
toggle, the round's questions listed with a **Serve** button each (the live one
highlighted), Previous / Next buttons, and Reset Round.

## R6 — Per-question timer must be client-side

**Today it is a hybrid, and the scoring half is server-side.** `TimerRing` draws
the countdown from the server's `question_started_at`
(`durationMs - (Date.now() - question_started_at)`), and `submit_response`
computes `response_time_ms` from `now() - question_started_at` on the Postgres
clock. A participant whose realtime push arrives 3 s late loses 3 s of their
answer window, and their score with it.

**Change — genuinely client-side:**

- `TimerRing` anchors on the local clock at the moment the question becomes
  active *on that client*. Every participant gets the full duration from when
  they actually see the question.
- The engine stamps `questionShownAt` locally and sends the elapsed time as a new
  `p_response_time_ms` argument to `submit_response`.
- The server clamps the supplied value to `[0, question_duration_ms]` and scores
  from it. If the client sends nothing, it falls back to the server computation
  (now fixed — see below).

**Trade-off, stated plainly:** this hands timing to the client, so a determined
participant could forge a 0 ms answer. For an in-class quiz that is the intended
exchange — nobody gets punished for their WiFi — but it is a real move away from
the v1 spec's "server-timestamped scoring". The server still owns correctness,
duplicate rejection and the points formula.

**One consequence worth knowing, in auto-advance mode.** Local anchors mean
clients no longer share a clock. Whichever client's countdown ends first calls
`advance_question` 2.5 s later, and that closes the question for everyone. A
participant whose realtime push arrived, say, 4 s late still gets a full 10 s
ring but only ~8.5 s of it counts before the question moves on; their late
answer is rejected with "Question is not current". The 2.5 s transition absorbs
ordinary jitter, not a badly lagged client.

Manual mode removes the problem entirely — nothing advances until the host
serves the next question — which is why it is the recommended way to run a live
session, and why serving a question turns it on automatically. This is the price
of the client-side timer and it is the intended trade: nobody is scored on
someone else's clock.

Question duration also moves out of the three places it is currently hardcoded
(ISSUES 3.4) into `round_state.question_duration_ms`, since both the client timer
and the server clamp now need to agree on one number.

---

## ISSUES.md items fixed here, and why each is required

| # | Item | Why it's in scope |
|---|---|---|
| 1.1 | `EXTRACT(MILLISECONDS …)` wraps every 60 s | The server path is now the fallback for R6; a broken fallback is worse than none. Use `EXTRACT(EPOCH …) * 1000`. |
| 1.3 | Round can't be re-run — stale responses block resubmission | R5 lets the host re-serve a question. Without a reset/clear path, the second serve rejects everyone. New `reset_round` RPC + clear-responses option on serve. |
| 1.4 | Client indexes by array position, server by `order_index` | R5 serves a question *by* `order_index`. The two addressing schemes must become one. |
| 1.6 | `SECURITY DEFINER` without `SET search_path` | Five new RPCs land in this pass; fixing the existing four at the same time is one edit. Also makes `crypt()`/`gen_salt()` resolution deterministic. |
| 1.7 | `submit_response` crashes on NULL `question_started_at` | The new serve/reset flows write `question_started_at` on more paths, so the NULL window widens. Guarded, returns a handled error. |
| 1.5 | `pin_hash` readable by anon | One-line `REVOKE SELECT (pin_hash) ON participants FROM anon`. Admin (authenticated) reads are unaffected. Cheap, and the login page is being touched anyway. |
| 3.1 | Deletes fail once responses exist | `reset_round` and participant delete both need this. `ON DELETE CASCADE` on `responses`, `SET NULL` on `round_state.active_participant_id`. |
| 3.4 | Duration hardcoded in three places | R6 needs one authoritative duration shared by client timer and server clamp. |
| 3.9 | Advance timeout not cancelled on unmount | `handleTimeUp` is being touched for manual mode anyway. |
| 2.6 | No PIN reset | A participant who fails the network check and re-logs on another device is the exact scenario. Cheap admin action. |
| 4.6 | No catch-all route | Routes are being added in this pass; a blank page on a typo during a live run is avoidable. |
| 2.4 | No SPA rewrite config | Participants will reload `/round/1`. `public/_redirects` + `vercel.json`. |

### Deliberately **not** fixed in this pass

- **2.1 / 2.2** — Live Dashboard is Round-1-only and omits participants who
  haven't answered. Real gaps, but neither blocks the six requirements. The
  Nominate button is added to the existing dashboard; the Round 2 view and the
  seed-from-participants fix are left for a follow-up.
- **2.3 / 4.4** — Module 6 shared-UI extraction and barrel consistency. A
  ~2,000-line restyling refactor that would touch every file this pass edits;
  doing both at once makes the diff unreviewable.
- **3.2** — `advance_question` concurrency. Manual mode sidesteps the pacing
  problem for host-driven runs; the underlying `FOR UPDATE` question stands.
- **3.5 / 3.6** — CSV name-nulling and quoted-field parsing. Unrelated to these
  six requirements.
- **3.7** — Question reorder as two unguarded writes. Related to 1.4 but a
  separate, RPC-shaped fix.
- **3.3** — Late answers scoring full base points. Partly mitigated: the server
  now clamps response time to the question duration, so time points floor at
  zero, but base points are still awarded. Rejecting outright is a scoring policy
  decision, not a bug fix — flagged for sign-off.
- **§5 open questions** — CSV format, more than 4 options, scoring formula
  sign-off. Still open, still need a human answer.

---

## Migration

Schema changes ship as `supabase/migration_v2.sql`, safe to run against the
existing database. `supabase/schema.sql` and `supabase/rpcs.sql` are updated in
place too, so a fresh setup from scratch produces the same result.

Run order on an existing project: `migration_v2.sql`, then `rpcs.sql`.
