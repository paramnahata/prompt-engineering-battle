/** Human-readable names for audit-log actions. */
const LABELS: Record<string, string> = {
  start_round1: 'Started Round 1', pause_round1: 'Paused Round 1', resume_round1: 'Resumed Round 1', stop_round1: 'Stopped Round 1',
  auto_end_round1: 'Round 1 ended automatically', reset_round1: 'Started Round 1 over', assign_late_round1: 'Assigned late arrivals',
  start_round2: 'Started Round 2', pause_round2: 'Paused Round 2', resume_round2: 'Resumed Round 2', stop_round2: 'Stopped Round 2',
  auto_end_round2: 'Round 2 ended automatically', reset_round2: 'Started Round 2 over', reveal_twist_round2: 'Revealed the Round 2 twist',
  round2_config: 'Saved Round 2 settings', round1_settings: 'Saved Round 1 settings',
  compute_round1_results: 'Computed Round 1 results', compute_final_results: 'Computed final results',
  results_publication_round1: 'Changed Round 1 result visibility', results_publication_final: 'Changed final result visibility',
  reset_competition: 'Reset competition data', reset_participants: 'Cleared all participants',
  score_override: 'Overrode a Round 1 score', round2_score_override: 'Overrode a Round 2 score', unlock_jury_score: 'Unlocked a jury score',
  announcement_publish: 'Published an announcement', announcement_hide: 'Hid an announcement', announcement_show: 'Re-showed an announcement', announcement_delete: 'Deleted an announcement',
  export_csv: 'Exported a CSV', retry_failed_evaluations: 'Retried failed evaluations', retry_failed_round2_evaluations: 'Retried failed Round 2 evaluations',
  issue_pins: 'Issued team PINs', reissue_pin: 'Re-issued a team PIN', challenge_pool_publish: 'Published a challenge file',
};

export function activityLabel(action: string): string {
  if (LABELS[action]) return LABELS[action];
  if (action.startsWith('round2_qualifiers_')) return 'Changed Round 2 finalists';
  if (action.startsWith('round2_problem_')) return 'Edited Round 2 problems';
  if (action.startsWith('round2_twist_')) return 'Edited Round 2 twists';
  if (action.startsWith('challenge_')) return 'Edited the challenge pool';
  return action.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
