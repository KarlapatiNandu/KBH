import QuestionConsole from './QuestionConsole';

/**
 * Round 1's half of Round Control — Fastest Finger First.
 *
 * Split out of RoundControl for the same reason it is the narrow column in
 * that layout: Round 1 is one synchronized race down a fixed order, and it
 * needs a console and a start button and nothing else. Round 2 has a hot
 * seat, four lifelines, a prize ladder and a tiered question pool. Keeping
 * the two in one file meant every change to the hot seat's machinery walked
 * past this, and every rule about one round's layout had to be written as an
 * exception to the other's.
 *
 * Props:
 *   roundState — the round 1 round_state row
 *   questions  — round 1's questions, ordered by order_index
 *   onResult(message, type) — toast callback owned by the parent
 *   onChanged() — refetch hint after a write
 *   onStart() / onEnd() — round lifecycle, owned by RoundControl
 */

export default function Round1Panel({ roundState, questions, onResult, onChanged, onStart, onEnd }) {
  const isActive = roundState?.status === 'active';

  return (
    <div className="r1p">
      <p className="r1p-desc">
        Synchronized round for all participants. Starting it puts the first
        question live for everyone connected.
      </p>

      <QuestionConsole
        round={1}
        roundState={roundState}
        questions={questions}
        onResult={onResult}
        onChanged={onChanged}
      />

      <button
        className={`btn r1p-go ${isActive ? 'btn-danger' : 'btn-primary'}`}
        onClick={() => {
          if (isActive) {
            if (window.confirm('End Round 1 early?')) onEnd();
          } else if (window.confirm('Start Round 1 now?')) {
            onStart();
          }
        }}
      >
        {isActive ? 'End Round 1' : 'Start Round 1'}
      </button>

      <style>{`
        .r1p {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          /* Flex children are min-width:auto by default, so the console's
             widest question would set this panel's width — and through the
             grid, the whole page's. */
          min-width: 0;
        }

        .r1p-desc {
          color: var(--pale-gold);
          font-size: 14px;
          margin-bottom: var(--space-lg);
          line-height: 1.5;
        }

        .r1p-go { flex-shrink: 0; }

        /* One thumb, one column: a start button that has to be aimed at on a
           phone is the wrong button to make small. */
        @media (max-width: 560px) {
          .r1p-go { width: 100%; }
        }
      `}</style>
    </div>
  );
}
