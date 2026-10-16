/**
 * Typing-only fields. The `paste` event alone is not enough on phones: Android
 * keyboards (Gboard clipboard chips, Samsung keyboard) insert clipboard text as
 * ordinary input without firing `paste`. So every change is also checked for
 * paste/drop input types and for large single-step insertions, which normal
 * typing, swipe typing and autocorrect never produce.
 */
export const MAX_TYPED_BURST = 40;

export function isPasteLikeChange(prev: string, next: string, nativeEvent: Event | undefined): boolean {
  const ev = nativeEvent as InputEvent | undefined;
  const inputType = typeof ev?.inputType === 'string' ? ev.inputType : '';
  if (/^insertFrom(Paste|Drop|Yank|PasteAsQuotation)/.test(inputType)) return true;
  if (typeof ev?.data === 'string' && ev.data.length > MAX_TYPED_BURST) return true;
  return next.length - prev.length > MAX_TYPED_BURST;
}

let lastLog = 0;
/** Records a blocked paste for the organizers (at most once every 5 s). */
export function logPasteBlocked() {
  const now = Date.now();
  if (now - lastLog < 5000) return;
  lastLog = now;
  fetch('/api/student/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_type: 'paste_blocked' }), keepalive: true }).catch(() => {});
}
