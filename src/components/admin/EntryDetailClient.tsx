'use client';

import { useEffect, useState } from 'react';

interface PSRow {
  assignment: {
    id: string;
    position: number;
    is_common: boolean;
    challenges: { title: string; problem_statement: string; prompt_word_limit: number; output_char_limit: number } | null;
  };
  submission: {
    id: string;
    prompt_text: string;
    ai_output_text: string;
    status: string;
    submitted_at: string | null;
    submission_ref: string | null;
  } | null;
  aiEval: {
    prompt_clarity: number;
    context: number;
    specificity: number;
    creativity: number;
    constraint_handling: number;
    total: number;
    originality_score: number | null;
    plagiarism_flag: boolean;
    flags: string[];
    summary: string | null;
  } | null;
  latestReview: { old_total: number | null; new_total: number; reason: string; created_at: string } | null;
}

export default function EntryDetailClient({ entryId }: { entryId: string }) {
  const [entry, setEntry] = useState<any>(null);
  const [ps, setPs] = useState<PSRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/entries/${entryId}/round1`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Failed to load');
        return;
      }
      setEntry(body.entry);
      setPs(Array.isArray(body.ps) ? body.ps : []);
      setError(null);
    } catch {
      setError('Could not load this entry. Refresh the page and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const overrideScore = async (row: PSRow) => {
    if (!row.submission) return;
    const current = row.latestReview?.new_total ?? row.aiEval?.total ?? 0;
    const input = prompt(`New score out of 50 (current: ${current}):`, String(current));
    if (input === null) return;
    const newTotal = Number(input);
    if (!Number.isFinite(newTotal) || newTotal < 0 || newTotal > 50) {
      alert('Enter a number between 0 and 50.');
      return;
    }
    const reason = prompt('Reason for this change (required):');
    if (!reason) return;
    const res = await fetch(`/api/admin/entries/${entryId}/round1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId: row.submission.id, newTotal, reason }),
    });
    if (res.ok) {
      load();
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? 'Failed to update score');
    }
  };

  if (loading) return <p className="text-muted text-sm">Loading…</p>;
  if (error) return <div className="text-sm text-red-400">{error}<button className="ml-3 underline" onClick={() => void load()}>Retry</button></div>;
  if (!entry) return <p className="text-sm text-muted">Entry not found.</p>;

  return (
    <div className="max-w-3xl flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{entry.entry_code}</h1>
        {entry.is_team ? (
          <>
            <p className="text-muted text-sm">{entry.team_name || 'Unnamed team'}</p>
            <p className="text-muted text-sm">
              {entry.team_members
                ?.sort((a: any, b: any) => a.member_position - b.member_position)
                .map((m: any) => m.full_name)
                .join(', ')}
            </p>
          </>
        ) : (
          <p className="text-muted text-sm">{entry.team_members?.[0]?.full_name}</p>
        )}
      </div>

      {ps.map((row) => {
        const effectiveScore = row.latestReview?.new_total ?? row.aiEval?.total ?? null;
        return (
          <div key={row.assignment.id} className="peb-card">
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="text-xs text-muted">
                  PS {row.assignment.position} {row.assignment.is_common && '(common)'}
                </div>
                <div className="font-medium">{row.assignment.challenges?.title ?? 'Challenge unavailable'}</div>
              </div>
              <span
                className={`text-xs px-2 py-1 rounded-full ${
                  row.submission?.status === 'submitted'
                    ? 'bg-green-500/20 text-green-400'
                    : row.submission?.status === 'locked'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-surface text-muted'
                }`}
              >
                {row.submission?.status ?? 'not started'}
              </span>
            </div>

            <p className="text-xs text-muted whitespace-pre-wrap mb-3">{row.assignment.challenges?.problem_statement ?? 'The challenge linked to this assignment is no longer available.'}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <div className="text-xs text-muted mb-1">Prompt</div>
                <div className="bg-surface border border-border rounded-lg p-2 text-sm whitespace-pre-wrap min-h-[3rem]">
                  {row.submission?.prompt_text || <span className="text-muted">— empty —</span>}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted mb-1">AI Output</div>
                <div className="bg-surface border border-border rounded-lg p-2 text-sm whitespace-pre-wrap min-h-[3rem]">
                  {row.submission?.ai_output_text || <span className="text-muted">— empty —</span>}
                </div>
              </div>
            </div>

            {row.aiEval ? (
              <div className="text-xs text-muted flex flex-wrap gap-3 mb-2">
                <span>Clarity {row.aiEval.prompt_clarity}</span>
                <span>Context {row.aiEval.context}</span>
                <span>Specificity {row.aiEval.specificity}</span>
                <span>Creativity {row.aiEval.creativity}</span>
                <span>Constraints {row.aiEval.constraint_handling}</span>
                {row.aiEval.originality_score !== null && <span>Originality {row.aiEval.originality_score}</span>}
                {row.aiEval.plagiarism_flag && <span className="text-red-400">⚠ Plagiarism flagged</span>}
              </div>
            ) : (
              <p className="text-xs text-muted mb-2">Not yet AI-evaluated.</p>
            )}

            {row.aiEval?.flags && row.aiEval.flags.length > 0 && (
              <p className="text-xs text-amber-400 mb-2">Flags: {row.aiEval.flags.join(', ')}</p>
            )}

            <div className="flex items-center justify-between">
              <div className="text-sm">
                Score: <span className="font-semibold text-accent-cyan">{effectiveScore ?? '—'}</span> / 50
                {row.latestReview && (
                  <span className="text-xs text-muted ml-2">
                    (overridden from {row.latestReview.old_total ?? '—'} — {row.latestReview.reason})
                  </span>
                )}
              </div>
              {row.submission && (
                <button className="peb-btn-secondary text-xs" onClick={() => overrideScore(row)}>
                  Override score
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
