// Mock Gemini generateContent endpoint for local tests (never used in production).
// Latency 200-1200ms, ~5% HTTP 429, ~2% HTTP 500, deterministic scores.
import http from 'node:http';
let calls = 0, ok = 0, r429 = 0, r500 = 0;
const FAIL = process.env.MOCK_FAILURES !== '0';
http.createServer((req, res) => {
  if (req.url === '/stats') { res.end(JSON.stringify({ calls, ok, r429, r500 })); return; }
  if (req.url === '/reset') { calls = ok = r429 = r500 = 0; res.end('{}'); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls++;
    if (!req.headers['x-goog-api-key']) { res.writeHead(403); res.end('{"error":"no key"}'); return; }
    const delay = 200 + Math.random() * 1000;
    setTimeout(() => {
      const roll = Math.random();
      if (FAIL && roll < 0.05) { r429++; res.writeHead(429); res.end('{"error":{"code":429}}'); return; }
      if (FAIL && roll < 0.07) { r500++; res.writeHead(500); res.end('{"error":{"code":500}}'); return; }
      let prompt = '';
      try { prompt = JSON.parse(JSON.parse(body).contents[0].parts[0].text).participant_prompt ?? ''; } catch {}
      const s = Math.min(10, 2 + (prompt.length % 9));
      ok++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ prompt_clarity: s, context: s, specificity: s - 1, creativity: s, constraint_handling: s, originality_score: 5, plagiarism_flag: false, flags: [], summary: 'Mock evaluation.' }) }] } }], usageMetadata: { totalTokenCount: 100 } }));
    }, delay);
  });
}).listen(Number(process.env.MOCK_GEMINI_PORT ?? 54340), '127.0.0.1');
