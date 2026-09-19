import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import QuestionCsvImport from './QuestionCsvImport';
import { hasRungColumn } from './tiers';

/**
 * Declared at module scope on purpose: defining it inside QuestionManager
 * makes React see a new component type on every render, remounting the
 * subtree so option inputs lose focus after each keystroke. (ISSUES 3.8)
 */
function OptionEditor({ options, correctOption, onChange, onCorrectChange }) {
  return (
    <div className="option-editor">
      {options.map((opt, i) => (
        <div key={i} className="option-row">
          <span className="option-label">{String.fromCharCode(65 + i)}</span>
          <input
            type="text"
            className="form-input option-input"
            value={opt}
            onChange={(e) => {
              const updated = [...options];
              updated[i] = e.target.value;
              onChange(updated);
            }}
            placeholder={`Option ${String.fromCharCode(65 + i)}`}
          />
          <button
            type="button"
            className={`btn-correct ${correctOption === i ? 'btn-correct--active' : ''}`}
            onClick={() => onCorrectChange(i)}
            title="Mark as correct"
          >
            ✓
          </button>
        </div>
      ))}
    </div>
  );
}


/**
 * R16 — which prize rung a Round 2 question is played for. A list of the
 * ladder's own rungs rather than a number box: the host thinks in money
 * ("the ₹40,000 question"), and a number typed past the top of the ladder is
 * a question that quietly never gets asked.
 *
 * Blank is a real choice, not a missing one — a question written before the
 * ladder was drawn up is unfiled, and the host's console lists those
 * separately instead of playing them for the bottom rung.
 */
function RungPicker({ value, rungs, onChange }) {
  // A rung the ladder no longer has — it was shortened after this question
  // was filed. Kept as an option so editing anything else about the question
  // does not silently move it.
  const orphaned = value !== '' && !rungs.some((r) => String(r.level) === String(value));

  return (
    <select
      className="form-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Which prize rung this question is played for"
    >
      <option value="">Not on the ladder</option>
      {/* Nothing to file onto: the ladder is drawn up in Round Control, and
          without it the picker is one meaningless choice. */}
      {rungs.length === 0 && (
        <option value="" disabled>— set the prize ladder up in Round Control —</option>
      )}
      {rungs.map((r) => (
        <option key={r.level} value={r.level}>
          {r.level} — {r.label}{r.is_milestone ? ' ✦' : ''}
        </option>
      ))}
      {orphaned && <option value={value}>{value} — off the ladder</option>}
    </select>
  );
}

// R8 — time is edited in seconds and stored in ms; blank means "use the
// round default" (round_state.question_duration_ms). Prize is free text.
// R16 — ladder_level is held as a string while it is a form field, blank for
// "not on the ladder", and turned into a number or NULL on save.
const EMPTY_QUESTION = {
  round: 1,
  text: '',
  options: ['', '', '', ''],
  correct_option: 0,
  base_points: 100,
  duration_s: '',
  prize: '',
  ladder_level: '',
};

const msToSeconds = (ms) => (ms == null ? '' : String(ms / 1000));
const secondsToMs = (s) => {
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
};

const toRung = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default function QuestionManager() {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRound, setFilterRound] = useState(0); // 0 = all
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [toast, setToast] = useState(null);
  const [newQuestion, setNewQuestion] = useState(EMPTY_QUESTION);
  // R16 — the rungs a Round 2 question can be filed on. Read once: the ladder
  // is edited in Round Control, and a host is not doing both at the same time.
  const [rungs, setRungs] = useState([]);

  useEffect(() => {
    fetchQuestions();
    fetchRungs();
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // No error branch: a database without migration_v10 has no ladder, and an
  // empty rung list already reads as "nothing to file onto yet".
  const fetchRungs = async () => {
    const { data } = await supabase
      .from('prize_ladder')
      .select('level, label, is_milestone')
      .eq('round', 2)
      .order('level');
    if (data) setRungs(data);
  };

  const fetchQuestions = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .order('round', { ascending: true })
      .order('order_index', { ascending: true });

    if (error) {
      showToast('Failed to load questions', 'error');
    } else {
      setQuestions(data || []);
    }
    setLoading(false);
  };

  const filtered = filterRound === 0
    ? questions
    : questions.filter((q) => q.round === filterRound);

  // R16 — naming `ladder_level` in an insert or update against a database
  // without migration_v11 fails the whole statement, which would break adding
  // and editing every question, not just the rung. So the field is hidden and
  // left out of the payload until the column is actually there.
  const canFileRungs = hasRungColumn(questions);

  const startEdit = (q) => {
    setEditingId(q.id);
    setEditForm({
      text: q.text,
      options: [...q.options],
      correct_option: q.correct_option,
      base_points: q.base_points,
      duration_s: msToSeconds(q.duration_ms),
      prize: q.prize ?? '',
      ladder_level: q.ladder_level == null ? '' : String(q.ladder_level),
      round: q.round,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async (id) => {
    const { error } = await supabase
      .from('questions')
      .update({
        text: editForm.text,
        options: editForm.options,
        correct_option: editForm.correct_option,
        base_points: editForm.base_points,
        duration_ms: secondsToMs(editForm.duration_s),
        prize: editForm.prize.trim() || null,
        // Round 1 has no ladder, so a rung on one of its questions is noise
        // that the console would have to filter out again. (R16)
        ...(canFileRungs
          ? { ladder_level: editForm.round === 2 ? toRung(editForm.ladder_level) : null }
          : {}),
      })
      .eq('id', id);

    if (error) {
      showToast('Failed to update question', 'error');
    } else {
      showToast('Question updated');
      setEditingId(null);
      fetchQuestions();
    }
  };

  const deleteQuestion = async (question) => {
    if (!window.confirm('Delete this question? This cannot be undone.')) return;

    const { error } = await supabase.from('questions').delete().eq('id', question.id);
    if (error) {
      showToast('Failed to delete question', 'error');
      return;
    }

    // Close the gap this leaves in order_index. The server addresses the live
    // question by order_index, so a hole would desynchronise the round and
    // break the host console's Next/Previous. (ISSUES 1.4)
    const { error: renumberError } = await supabase.rpc('renumber_questions', {
      p_round: question.round,
    });

    showToast(
      renumberError
        ? 'Question deleted, but renumbering failed — check question order'
        : 'Question deleted',
      renumberError ? 'error' : 'success'
    );
    fetchQuestions();
  };

  const addQuestion = async () => {
    // Get current max order_index for the round
    const roundQs = questions.filter((q) => q.round === newQuestion.round);
    const maxOrder = roundQs.length > 0
      ? Math.max(...roundQs.map((q) => q.order_index))
      : -1;

    const { error } = await supabase.from('questions').insert({
      round: newQuestion.round,
      text: newQuestion.text,
      options: newQuestion.options,
      correct_option: newQuestion.correct_option,
      base_points: newQuestion.base_points,
      duration_ms: secondsToMs(newQuestion.duration_s),
      prize: newQuestion.prize.trim() || null,
      ...(canFileRungs
        ? { ladder_level: newQuestion.round === 2 ? toRung(newQuestion.ladder_level) : null }
        : {}),
      order_index: maxOrder + 1,
    });

    if (error) {
      showToast('Failed to add question', 'error');
    } else {
      showToast('Question added');
      setShowAdd(false);
      setNewQuestion(EMPTY_QUESTION);
      fetchQuestions();
    }
  };

  const moveQuestion = async (q, direction) => {
    const roundQs = questions
      .filter((x) => x.round === q.round)
      .sort((a, b) => a.order_index - b.order_index);

    const idx = roundQs.findIndex((x) => x.id === q.id);
    const swapIdx = idx + direction;

    if (swapIdx < 0 || swapIdx >= roundQs.length) return;

    const other = roundQs[swapIdx];

    // Swap order_index values
    await supabase.from('questions').update({ order_index: other.order_index }).eq('id', q.id);
    await supabase.from('questions').update({ order_index: q.order_index }).eq('id', other.id);

    fetchQuestions();
  };


  return (
    <div className="qm">
      {/* Toolbar */}
      <div className="qm-toolbar">
        <div className="qm-filters">
          <button
            className={`btn btn-sm ${filterRound === 0 ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilterRound(0)}
          >All</button>
          <button
            className={`btn btn-sm ${filterRound === 1 ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilterRound(1)}
          >Round 1</button>
          <button
            className={`btn btn-sm ${filterRound === 2 ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilterRound(2)}
          >Round 2</button>
        </div>
        <div className="qm-toolbar-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { setShowImport((v) => !v); setShowAdd(false); }}
          >
            ⬆ Import CSV
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setShowAdd(true); setShowImport(false); }}
          >
            + Add Question
          </button>
        </div>
      </div>

      {/* Bulk import — questions are usually written in a spreadsheet first */}
      {showImport && (
        <QuestionCsvImport
          onImported={fetchQuestions}
          onClose={() => setShowImport(false)}
          showToast={showToast}
        />
      )}

      {/* Add Question Form */}
      {showAdd && (
        <div className="qm-add-form card card--solid">
          <h3>New Question</h3>
          <div className="qm-add-fields">
            <div className="qm-add-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Round</label>
                <select
                  className="form-select"
                  value={newQuestion.round}
                  onChange={(e) => setNewQuestion({ ...newQuestion, round: parseInt(e.target.value) })}
                >
                  <option value={1}>Round 1</option>
                  <option value={2}>Round 2</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Base Points</label>
                <input
                  type="number"
                  className="form-input"
                  value={newQuestion.base_points}
                  onChange={(e) => setNewQuestion({ ...newQuestion, base_points: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Time (s)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="form-input"
                  placeholder="Round default"
                  value={newQuestion.duration_s}
                  onChange={(e) => setNewQuestion({ ...newQuestion, duration_s: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Prize</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. ₹10,000"
                  value={newQuestion.prize}
                  onChange={(e) => setNewQuestion({ ...newQuestion, prize: e.target.value })}
                />
              </div>
              {/* R16 — Round 2 only: Round 1 is a fixed queue with no ladder
                  behind it, so there is no rung to play a question for. */}
              {newQuestion.round === 2 && canFileRungs && (
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Prize rung</label>
                  <RungPicker
                    value={newQuestion.ladder_level}
                    rungs={rungs}
                    onChange={(v) => setNewQuestion({ ...newQuestion, ladder_level: v })}
                  />
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Question Text</label>
              <input
                type="text"
                className="form-input"
                value={newQuestion.text}
                onChange={(e) => setNewQuestion({ ...newQuestion, text: e.target.value })}
                placeholder="Enter the question…"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Options (click ✓ to mark correct)</label>
              <OptionEditor
                options={newQuestion.options}
                correctOption={newQuestion.correct_option}
                onChange={(options) => setNewQuestion({ ...newQuestion, options })}
                onCorrectChange={(i) => setNewQuestion({ ...newQuestion, correct_option: i })}
              />
            </div>
            <div className="qm-add-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={addQuestion}
                disabled={!newQuestion.text.trim() || newQuestion.options.some((o) => !o.trim())}
              >
                Add Question
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Question List */}
      {loading ? (
        <div className="qm-loading">Loading questions…</div>
      ) : filtered.length === 0 ? (
        <div className="qm-empty">No questions found. A quiz needs questions — funny how that works.</div>
      ) : (
        <div className="qm-list">
          {filtered.map((q) => (
            <div key={q.id} className="qm-item card">
              <div className="qm-item-header">
                <div className="qm-item-meta">
                  <span className={`badge badge--${q.round === 1 ? 'active' : 'completed'}`}>
                    Round {q.round}
                  </span>
                  <span className="qm-order">#{q.order_index + 1}</span>
                  <span className="qm-points">{q.base_points} pts</span>
                  <span className="qm-points" title="Countdown for this question">
                    ⏱ {q.duration_ms != null ? `${q.duration_ms / 1000}s` : 'default'}
                  </span>
                  {q.prize && <span className="qm-prize">{q.prize}</span>}
                  {/* R16 — the rung it is played for. Called out when it has
                      none, because an unfiled Round 2 question is never
                      reached by the run. */}
                  {q.round === 2 && canFileRungs && (
                    q.ladder_level == null ? (
                      <span className="qm-rung qm-rung--unfiled" title="Not on the prize ladder — the run never reaches it">
                        no rung
                      </span>
                    ) : (
                      <span className="qm-rung" title="The prize rung this question is played for">
                        rung {q.ladder_level}
                      </span>
                    )
                  )}
                </div>
                <div className="qm-item-actions">
                  <button className="btn-icon" onClick={() => moveQuestion(q, -1)} title="Move up">↑</button>
                  <button className="btn-icon" onClick={() => moveQuestion(q, 1)} title="Move down">↓</button>
                  {editingId === q.id ? (
                    <>
                      <button className="btn btn-primary btn-sm" onClick={() => saveEdit(q.id)}>Save</button>
                      <button className="btn btn-secondary btn-sm" onClick={cancelEdit}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="btn-icon" onClick={() => startEdit(q)} title="Edit">✏️</button>
                      <button className="btn-icon" onClick={() => deleteQuestion(q)} title="Delete" style={{ color: 'var(--danger-red)' }}>🗑️</button>
                    </>
                  )}
                </div>
              </div>

              {editingId === q.id ? (
                <div className="qm-edit-body">
                  <div className="form-group">
                    <label className="form-label">Question Text</label>
                    <input
                      type="text"
                      className="form-input"
                      value={editForm.text}
                      onChange={(e) => setEditForm({ ...editForm, text: e.target.value })}
                    />
                  </div>
                  <div className="qm-add-row">
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Base Points</label>
                      <input
                        type="number"
                        className="form-input"
                        value={editForm.base_points}
                        onChange={(e) => setEditForm({ ...editForm, base_points: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Time (s)</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className="form-input"
                        placeholder="Round default"
                        value={editForm.duration_s}
                        onChange={(e) => setEditForm({ ...editForm, duration_s: e.target.value })}
                      />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Prize</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. ₹10,000"
                        value={editForm.prize}
                        onChange={(e) => setEditForm({ ...editForm, prize: e.target.value })}
                      />
                    </div>
                    {q.round === 2 && canFileRungs && (
                      <div className="form-group" style={{ flex: 1 }}>
                        <label className="form-label">Prize rung</label>
                        <RungPicker
                          value={editForm.ladder_level}
                          rungs={rungs}
                          onChange={(v) => setEditForm({ ...editForm, ladder_level: v })}
                        />
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Options</label>
                    <OptionEditor
                      options={editForm.options}
                      correctOption={editForm.correct_option}
                      onChange={(options) => setEditForm({ ...editForm, options })}
                      onCorrectChange={(i) => setEditForm({ ...editForm, correct_option: i })}
                    />
                  </div>
                </div>
              ) : (
                <div className="qm-item-body">
                  <p className="qm-question-text">{q.text}</p>
                  <div className="qm-options">
                    {q.options.map((opt, i) => (
                      <span key={i} className={`qm-option ${i === q.correct_option ? 'qm-option--correct' : ''}`}>
                        <span className="qm-option-letter">{String.fromCharCode(65 + i)}</span>
                        {opt}
                        {i === q.correct_option && <span className="qm-check">✓</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast toast--${toast.type}`}>{toast.message}</div>
      )}

      <style>{`
        .qm-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-lg);
          flex-wrap: wrap;
          gap: var(--space-md);
        }

        .qm-filters {
          display: flex;
          gap: var(--space-sm);
        }

        .qm-toolbar-actions {
          display: flex;
          gap: var(--space-sm);
        }

        .qm-add-form {
          margin-bottom: var(--space-lg);
          padding: var(--space-lg);
        }

        .qm-add-form h3 {
          margin-bottom: var(--space-md);
          font-size: 18px;
        }

        .qm-add-fields {
          display: flex;
          flex-direction: column;
          gap: var(--space-md);
        }

        .qm-add-row {
          display: flex;
          gap: var(--space-md);
          /* Five fields on one line (R16 added the fifth) squeeze the round
             select down to an unreadable stub on anything but a wide window. */
          flex-wrap: wrap;
        }

        .qm-add-row .form-group { min-width: 140px; }

        .qm-add-actions {
          display: flex;
          gap: var(--space-sm);
          justify-content: flex-end;
        }

        .option-editor {
          display: flex;
          flex-direction: column;
          gap: var(--space-sm);
        }

        .option-row {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
        }

        .option-label {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: var(--spotlight-gold);
          color: var(--deep-midnight);
          font-weight: 600;
          font-size: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .option-input {
          flex: 1;
        }

        .btn-correct {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1.5px solid var(--antique-gold);
          background: transparent;
          color: rgba(240, 244, 248, 0.35);
          font-size: 14px;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .btn-correct:hover {
          border-color: var(--success-green);
          color: var(--success-green);
        }

        .btn-correct--active {
          background: var(--success-green);
          border-color: var(--success-green);
          color: var(--deep-midnight);
        }

        .qm-loading, .qm-empty {
          text-align: center;
          padding: var(--space-2xl);
          color: var(--pale-gold);
          font-size: 15px;
        }

        .qm-list {
          display: flex;
          flex-direction: column;
          gap: var(--space-md);
        }

        .qm-item {
          padding: var(--space-md) var(--space-lg);
        }

        .qm-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--space-sm);
          flex-wrap: wrap;
          gap: var(--space-sm);
        }

        .qm-item-meta {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
        }

        .qm-order {
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          font-size: 14px;
          color: var(--spotlight-gold);
        }

        .qm-points {
          font-size: 12px;
          color: var(--pale-gold);
        }

        .qm-prize {
          font-family: 'Poppins', sans-serif;
          font-size: 12px;
          font-weight: 700;
          color: var(--spotlight-gold);
        }

        /* R16 */
        .qm-rung {
          font-family: 'Poppins', sans-serif;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: var(--radius-pill);
          border: 1px solid rgba(242,183,5,0.3);
          color: var(--pale-gold);
          white-space: nowrap;
        }

        .qm-rung--unfiled {
          border-color: var(--warning-amber);
          color: var(--warning-amber);
        }

        .qm-item-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .qm-question-text {
          font-family: 'Poppins', sans-serif;
          font-weight: 600;
          font-size: 16px;
          margin-bottom: var(--space-sm);
          line-height: 1.4;
        }

        .qm-options {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--space-sm);
        }

        .qm-option {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
          padding: 8px 14px;
          border-radius: var(--radius-sm);
          font-size: 14px;
          background: rgba(242,183,5,0.05);
        }

        .qm-option--correct {
          background: var(--success-green-soft);
          color: var(--success-green);
        }

        .qm-option-letter {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--spotlight-gold);
          color: var(--deep-midnight);
          font-weight: 600;
          font-size: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .qm-option--correct .qm-option-letter {
          background: var(--success-green);
        }

        .qm-check {
          margin-left: auto;
          font-size: 12px;
        }

        .qm-edit-body {
          display: flex;
          flex-direction: column;
          gap: var(--space-md);
          padding-top: var(--space-sm);
        }

        @media (max-width: 600px) {
          .qm-options {
            grid-template-columns: 1fr;
          }

          /* One field per line: a wrapped pair leaves one of them orphaned on
             its own row anyway, and labels stop lining up with their inputs. */
          .qm-add-row { flex-direction: column; }
          .qm-add-row .form-group { min-width: 0; }

          .qm-toolbar,
          .qm-filters,
          .qm-toolbar-actions { width: 100%; }

          .qm-filters .btn,
          .qm-toolbar-actions .btn { flex: 1; }

          .qm-item-header {
            flex-direction: column;
            align-items: flex-start;
            gap: var(--space-sm);
          }
        }
      `}</style>
    </div>
  );
}
