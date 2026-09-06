# Module 4 — Walkthrough & Expected Features

## Files Created

| File | Purpose |
|------|---------|
| [`Round1Engine.jsx`](file:///c:/Users/nandu/OneDrive/Desktop/Vth%20Sem/KBH/src/modules/round1/Round1Engine.jsx) | Orchestrator — game state machine, RPC calls, realtime subscription |
| [`QuestionCard.jsx`](file:///c:/Users/nandu/OneDrive/Desktop/Vth%20Sem/KBH/src/modules/round1/QuestionCard.jsx) | Question display with option pills + feedback |
| [`TimerRing.jsx`](file:///c:/Users/nandu/OneDrive/Desktop/Vth%20Sem/KBH/src/modules/round1/TimerRing.jsx) | SVG countdown ring synced to server time |
| [`Round1Results.jsx`](file:///c:/Users/nandu/OneDrive/Desktop/Vth%20Sem/KBH/src/modules/round1/Round1Results.jsx) | Post-round results + leaderboard |
| [`index.js`](file:///c:/Users/nandu/OneDrive/Desktop/Vth%20Sem/KBH/src/modules/round1/index.js) | Barrel exports |

## Files Modified

| File | Change |
|------|--------|
| [`App.jsx`](file:///c:/Users/nandu/OneDrive/Desktop/Vth%20Sem/KBH/src/App.jsx) | Added `/round/1` route, `ParticipantHomeWithNav` wrapper for navigation |
| [`instructions.md`](file:///c:/Users/nandu/OneDrive/Desktop/Vth%20Sem/KBH/instructions.md) | Added Build Progress section |

---

## Expected Features — What You Should See

### 1. Participant Home → Round 1 Entry
- Click "Enter Round →" on the Round 1 card → navigates to `/round/1`
- If not logged in, redirected to `/` (login)

### 2. Waiting Screen (Round inactive)
- Centered "Fastest Finger First" title with a clock icon (floating animation)
- "Waiting for the host to start the round…" message
- Animated pulsing dots (3 dots)
- "← Back" button returns to home

### 3. Active Question Screen (Round active)
- **Header**: "← Back" button | "Round 1" title | green "● LIVE" badge
- **Timer column** (left, sticky on desktop):
  - SVG ring countdown from 10s
  - Color transitions: teal (>5s) → amber (2.5–5s) → red (<2.5s)
  - Pulsing text animation when <2.5s
  - Shows "Time's up!" label when zero
- **Question column** (right):
  - Question number badge + "Question X of Y" counter + points badge
  - Question text
  - 2×2 option grid (pills with A/B/C/D labels)
  - Hover effects on pills (lift + shadow)
  - Click an option → submitting overlay → result feedback

### 4. Answer Feedback
- Correct answer pill turns **green** with ✓ icon
- Wrong answer pill turns **red** with ✗ icon, correct one turns green
- Non-selected pills fade to 35% opacity
- Result bar slides in below options:
  - Correct: "🎯 Correct! +XXX points (X.Xs)"
  - Wrong: "❌ Wrong! The correct answer was B"
- Submitting state: semi-transparent overlay with pulsing dot + "Submitting…"

### 5. Between Questions (Transition)
- 2.5-second pause after timer hits zero
- Fixed pill at bottom: "Next question incoming…" with spinner
- Timer ring freezes (paused)
- `advance_question` RPC fires after the delay (atomic — only first client advances)

### 6. Auto-Advance
- When countdown reaches 0, `handleTimeUp` fires
- If not answered, question locks (disabled)
- After transition delay, calls `advance_question(1)` RPC
- Realtime subscription picks up the new `current_question_index` → renders next question
- Answer state resets for the new question

### 7. Page Reload Handling
- On reload, checks server for existing response on current question
- If already answered → restores `selectedOption` + `lastResult` so feedback is visible
- Answered questions tracked in a `Set` ref to avoid re-checking

### 8. Round Completed Screen
- **Hero card**: Rank badge (#N), "Round 1 Complete!" title
- **Stats row**: Total Points | Correct/Total | Rank
- **Your Answers section**: Per-question breakdown rows showing:
  - Question number + text + correct/wrong/no-answer badge
  - Detail row: your answer letter, correct answer (if wrong), points, response time
- **Leaderboard — Top 10**: Table with gold/silver/bronze rank badges
  - Your row highlighted (teal background + bold)
  - Sorted by total points desc, then total time asc (tie-breaker)
- "← Back to Home" button

### 9. Responsive Layout
- Desktop: Timer left (sticky), question right (side-by-side)
- Mobile (<640px): Timer stacked above question, full-width
- Options grid: 2×2 on desktop, single column on mobile (<480px)

### 10. Error Handling
- RPC errors show an inline error toast (clickable to dismiss)
- "Already answered" RPC response gracefully fetches existing response
- Network errors caught and surfaced

### 11. Bug Fixes & Refinements
- **Timer and Response Time Fix**: Admin control now uses the `start_round` RPC to set `question_started_at` using the server's `now()` timestamp. This fixes an issue where the client-side `.update()` would fail silently due to RLS, resulting in a frozen 10s timer and a "response time can't be null" error upon submission.
- **Timer Fallback**: Added a defensive fallback in `TimerRing` to use `Date.now()` if the `questionStartedAt` is temporarily missing, ensuring the timer continues to function smoothly.
