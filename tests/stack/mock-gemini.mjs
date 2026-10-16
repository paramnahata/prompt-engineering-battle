// Mock Gemini generateContent endpoint for local tests (never used in production).
// Latency 200-1200ms, ~5% HTTP 429, ~2% HTTP 500, deterministic scores.
import http from 'node:http';
let calls = 0, ok = 0, r429 = 0, r500 = 0;
const FAIL = process.env.MOCK_FAILURES !== '0';
// Models whose daily quota is simulated as used up (to exercise the fallback model).
const DAILY_EXHAUSTED = (process.env.MOCK_DAILY_EXHAUSTED ?? '').split(',').filter(Boolean);
let byModel = {};
http.createServer((req, res) => {
  if (req.url === '/stats') { res.end(JSON.stringify({ calls, ok, r429, r500, byModel })); return; }
  if (req.url === '/reset') { calls = ok = r429 = r500 = 0; byModel = {}; res.end('{}'); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls++;
    if (!req.headers['x-goog-api-key']) { res.writeHead(403); res.end('{"error":"no key"}'); return; }
    const delay = 200 + Math.random() * 1000;
    setTimeout(() => {
      const roll = Math.random();
      const model = decodeURIComponent((req.url.match(/models\/([^:]+):/) ?? [])[1] ?? '');
      if (DAILY_EXHAUSTED.includes(model)) {
        r429++; res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota', details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3600s' }] } }));
        return;
      }
      if (FAIL && roll < 0.05) {
        r429++; res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '10' }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '2s' }] } }));
        return;
      }
      if (FAIL && roll < 0.07) { r500++; res.writeHead(500); res.end('{"error":{"code":500}}'); return; }
      let prompt = '';
      let keys = [];
      let msg = {};
      try {
        const req = JSON.parse(body);
        keys = Object.keys(req.generationConfig?.responseSchema?.properties ?? {});
        msg = JSON.parse(req.contents[0].parts[0].text);
        prompt = msg.participant_prompt ?? msg.participant_final_prompt ?? '';
      } catch {}
      const s = Math.min(10, 2 + (prompt.length % 9));
      let out;
      if (keys.includes('results')) {
        // Round 1 batch: one result per answer id.
        out = { results: (msg.answers ?? []).map((a) => {
          const v = Math.min(10, 2 + (String(a.participant_prompt ?? '').length % 9));
          return { id: a.id, prompt_clarity: v, context: v, specificity: v - 1, creativity: v, constraint_handling: v, originality_score: 5, plagiarism_flag: false, flags: [], summary: 'Mock batch evaluation.' };
        }) };
      } else if (keys.includes('questions')) {
        // Jury question suggestions (src/lib/round2/questions.ts).
        out = { questions: ['Which line of your prompt stops the AI from inventing missing numbers?', 'Walk us through one calculation in the output — is it correct?',
          'What did you change after the twist, and why?', 'Which assumption in the output is weakest?', 'How would you test this recommendation in 30 days?', 'Why this role for the AI?'] };
      } else if (keys.includes('problem_understanding')) {
        // Round 2 rubric (src/lib/gemini/round2.ts).
        out = { problem_understanding: s, prompt_structure: s, context_specificity: s - 1, creativity: s, constraint_handling: s, output_quality: s, flags: [], summary: 'Mock Round 2 evaluation.' };
      } else {
        out = { prompt_clarity: s, context: s, specificity: s - 1, creativity: s, constraint_handling: s, originality_score: 5, plagiarism_flag: false, flags: [], summary: 'Mock evaluation.' };
      }
      ok++;
      byModel[model] = (byModel[model] ?? 0) + 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(out) }] } }], usageMetadata: { totalTokenCount: 100 } }));
    }, delay);
  });
}).listen(Number(process.env.MOCK_GEMINI_PORT ?? 54340), '127.0.0.1');
