import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

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


export default function QuestionManager() {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRound, setFilterRound] = useState(0); // 0 = all
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState(null);
  const [newQuestion, setNewQuestion] = useState({
    round: 1,
    text: '',
    options: ['', '', '', ''],
    correct_option: 0,
    base_points: 100,
  });

  useEffect(() => {
    fetchQuestions();
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
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

  const startEdit = (q) => {
    setEditingId(q.id);
    setEditForm({
      text: q.text,
      options: [...q.options],
      correct_option: q.correct_option,
      base_points: q.base_points,
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
      order_index: maxOrder + 1,
    });

    if (error) {
      showToast('Failed to add question', 'error');
    } else {
      showToast('Question added');
      setShowAdd(false);
      setNewQuestion({ round: 1, text: '', options: ['', '', '', ''], correct_option: 0, base_points: 100 });
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
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
          + Add Question
        </button>
      </div>

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
        <div className="qm-empty">No questions found. Add one to get started.</div>
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
        }

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
          background: var(--ocean-aqua);
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
          border: 1.5px solid var(--twilight-teal);
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
          color: var(--serene-seafoam);
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
          color: var(--ocean-aqua);
        }

        .qm-points {
          font-size: 12px;
          color: var(--serene-seafoam);
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
          background: rgba(36,184,175,0.05);
        }

        .qm-option--correct {
          background: var(--success-green-soft);
          color: var(--success-green);
        }

        .qm-option-letter {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--ocean-aqua);
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
        }
      `}</style>
    </div>
  );
}
