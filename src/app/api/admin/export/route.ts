import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { csvResponse, toCsv, type Cell } from '@/lib/csv/export';
import { limitAction } from '@/lib/ops/rate-limit';
import { jsonError, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TYPES = ['participants', 'logins', 'round1_results', 'round1_answers', 'round2_work', 'jury_scores', 'final_results', 'audit_log'] as const;
const querySchema = z.object({ type: z.enum(TYPES) });
type Member = { member_position: number; full_name: string; email: string | null; phone: string | null; college: string | null; branch: string | null; study_year: string | null };
const one = <T,>(v: unknown): T | null => ((Array.isArray(v) ? v[0] : v) ?? null) as T | null;
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

/**
 * Organizer CSV exports (admin only; rate-limited). PINs and PIN hashes are
 * never exported — only whether a PIN has been issued.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const q = querySchema.safeParse({ type: req.nextUrl.searchParams.get('type') });
  if (!q.success) return jsonError(`Unknown export. Use one of: ${TYPES.join(', ')}`, 400);
  try {
    const limited = await limitAction(`export:${auth.session.userId}`, 30, 300);
    if (limited) return limited;
    const db = supabaseAdmin();
    const type = q.data.type;
    let headers: string[] = [];
    let rows: Cell[][] = [];

    if (type === 'participants') {
      const { data, error } = await db.from('entries')
        .select('entry_number, registration_id, team_name, is_team, present, disqualified, disqualified_reason, pin_set_at, created_at, team_members(member_position, full_name, email, phone, college, branch, study_year)')
        .order('entry_number').limit(5000);
      if (error) throw error;
      headers = ['Entry', 'Registration ID', 'Team', 'Members', 'Checked in', 'Disqualified', 'Reason', 'PIN issued',
        'Member 1', 'Member 1 email', 'Member 1 phone', 'Member 1 college', 'Member 1 branch', 'Member 1 year',
        'Member 2', 'Member 2 email', 'Member 2 phone', 'Member 2 college', 'Member 2 branch', 'Member 2 year', 'Registered at'];
      rows = (data ?? []).map((e) => {
        const ms = ((e.team_members ?? []) as Member[]).sort((a, b) => a.member_position - b.member_position);
        const m = (i: number): Cell[] => { const x = ms[i]; return x ? [x.full_name, x.email, x.phone, x.college, x.branch, x.study_year] : ['', '', '', '', '', '']; };
        return [e.entry_number, e.registration_id, e.team_name, ms.length, e.present ? 'yes' : 'no', e.disqualified ? 'yes' : 'no', e.disqualified_reason,
          e.pin_set_at ? 'yes' : 'no', ...m(0), ...m(1), e.created_at];
      });
    } else if (type === 'logins') {
      const { data, error } = await db.rpc('admin_live_participants');
      if (error) throw error;
      headers = ['Entry', 'Team', 'Members', 'Checked in', 'Status', 'Signed in at', 'Last seen', 'Ended at', 'End reason'];
      rows = ((data ?? []) as Record<string, Cell>[]).map((r) => [r.entry_number, r.team_name, r.member_names, r.present ? 'yes' : 'no', r.status, r.session_started_at, r.last_seen_at, r.ended_at, r.end_reason]);
    } else if (type === 'round1_results') {
      const { data: r1 } = await db.from('rounds').select('id').eq('round_number', 1).single();
      const { data, error } = await db.from('round_results').select('rank, score, qualified, computed_at, entry:entries(entry_number, team_name)').eq('round_id', r1?.id).order('rank').limit(5000);
      if (error) throw error;
      headers = ['Rank', 'Entry', 'Team', 'Score (of 200)', 'Qualified', 'Computed at'];
      rows = (data ?? []).map((r) => { const e = one<{ entry_number: number; team_name: string | null }>(r.entry); return [r.rank, e?.entry_number, e?.team_name, r.score, r.qualified ? 'yes' : 'no', r.computed_at]; });
    } else if (type === 'round1_answers') {
      const { data, error } = await db.from('submissions')
        .select('status, submitted_at, submission_ref, prompt_text, ai_output_text, entry:entries(entry_number, team_name), assignment:challenge_assignments(position, is_common, challenge_snapshot), ai:ai_evaluations(total, summary, flags), reviews:human_reviews(new_total, reason, created_at)')
        .limit(10000);
      if (error) throw error;
      headers = ['Entry', 'Team', 'Challenge #', 'Common', 'PS ID', 'Title', 'Status', 'Submitted at', 'Reference', 'AI score (of 50)', 'Override', 'Final score', 'AI summary', 'Flags', 'Prompt', 'AI output'];
      rows = (data ?? []).map((s) => {
        const e = one<{ entry_number: number; team_name: string | null }>(s.entry);
        const a = one<{ position: number; is_common: boolean; challenge_snapshot: { challenge_code?: string; title?: string } | null }>(s.assignment);
        const ai = one<{ total: number; summary: string | null; flags: string[] }>(s.ai);
        const rv = ((s.reviews ?? []) as { new_total: number; created_at: string }[]).sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
        return [e?.entry_number, e?.team_name, a?.position, a?.is_common ? 'yes' : 'no', a?.challenge_snapshot?.challenge_code, a?.challenge_snapshot?.title, s.status, s.submitted_at,
          s.submission_ref, ai?.total, rv?.new_total, rv?.new_total ?? ai?.total, ai?.summary, (ai?.flags ?? []).join(' '), s.prompt_text, s.ai_output_text];
      }).sort((x, y) => Number(x[0]) - Number(y[0]) || Number(x[2]) - Number(y[2]));
    } else if (type === 'round2_work') {
      const { data, error } = await db.from('round2_states')
        .select('state, submission_ref, auto_submitted, final_submitted_at, initial_prompt, initial_output, final_prompt, final_output, rationale, twist_snapshot, entry:entries(entry_number, team_name)').limit(1000);
      if (error) throw error;
      headers = ['Entry', 'Team', 'Stage', 'Reference', 'Auto-submitted', 'Final submitted at', 'Twist', 'Initial prompt', 'Initial output', 'Final prompt', 'Final output', 'Rationale'];
      rows = (data ?? []).map((s) => { const e = one<{ entry_number: number; team_name: string | null }>(s.entry); return [e?.entry_number, e?.team_name, s.state, s.submission_ref, s.auto_submitted ? 'yes' : 'no', s.final_submitted_at, (s.twist_snapshot as { title?: string } | null)?.title, s.initial_prompt, s.initial_output, s.final_prompt, s.final_output, s.rationale]; })
        .sort((x, y) => Number(x[0]) - Number(y[0]));
    } else if (type === 'jury_scores') {
      const { data, error } = await db.from('judge_scores')
        .select('understanding, response_quality, adaptability, interaction, total, max_total, question_scores, locked, notes, saved_at, judge:judges(full_name), entry:entries(entry_number, team_name)').limit(5000);
      if (error) throw error;
      headers = ['Entry', 'Team', 'Judge', 'Understanding', 'Response quality', 'Adaptability', 'Interaction', 'Questions and marks', 'Total', 'Out of', 'Locked', 'Notes', 'Saved at'];
      rows = (data ?? []).map((s) => {
        const e = one<{ entry_number: number; team_name: string | null }>(s.entry); const j = one<{ full_name: string }>(s.judge);
        const qs = Array.isArray(s.question_scores) ? (s.question_scores as { question: string; mark: number }[]).map((q, i) => `Q${i + 1} [${q.mark}] ${q.question}`).join(' | ') : '';
        return [e?.entry_number, e?.team_name, j?.full_name, s.understanding, s.response_quality, s.adaptability, s.interaction, qs, s.total, s.max_total, s.locked ? 'yes' : 'no', s.notes, s.saved_at];
      })
        .sort((x, y) => Number(x[0]) - Number(y[0]));
    } else if (type === 'final_results') {
      const { data, error } = await db.from('final_results').select('rank, round1_score, round2_jury, round2_ai, round2_score, final_score, released, computed_at, entry:entries(entry_number, team_name)').order('rank').limit(1000);
      if (error) throw error;
      headers = ['Rank', 'Entry', 'Team', 'Round 1', 'Round 2 jury', 'Round 2 system (AI)', 'Round 2 total', 'Final', 'Published', 'Computed at'];
      rows = (data ?? []).map((r) => { const e = one<{ entry_number: number; team_name: string | null }>(r.entry); return [r.rank, e?.entry_number, e?.team_name, r.round1_score, r.round2_jury, r.round2_ai, r.round2_score, r.final_score, r.released ? 'yes' : 'no', r.computed_at]; });
    } else {
      const { data, error } = await db.from('admin_actions').select('created_at, action, reason, admin:admins(full_name, email), entry:entries(entry_number), new_value').order('created_at', { ascending: false }).limit(5000);
      if (error) throw error;
      headers = ['When', 'Action', 'By', 'Entry', 'Reason', 'Details'];
      rows = (data ?? []).map((a) => { const ad = one<{ full_name: string; email: string }>(a.admin); const e = one<{ entry_number: number }>(a.entry); return [a.created_at, a.action, ad ? `${ad.full_name} <${ad.email}>` : 'system', e?.entry_number, a.reason, a.new_value ? JSON.stringify(a.new_value).slice(0, 2000) : '']; });
    }

    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'export_csv', new_value: { type, rows: rows.length } });
    return csvResponse(`peb-${type}-${stamp()}.csv`, toCsv(headers, rows));
  } catch (err) {
    return serverError('export', err, 'Could not build the export.');
  }
}
