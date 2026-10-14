// Maps Supabase's /rest/v1/* to a local PostgREST, so supabase-js works unchanged.
import http from 'node:http';
const target = { host: '127.0.0.1', port: Number(process.env.PGRST_PORT ?? 54330) };
http.createServer((req, res) => {
  const path = req.url.startsWith('/rest/v1') ? req.url.slice('/rest/v1'.length) || '/' : req.url;
  const p = http.request({ ...target, path, method: req.method, headers: { ...req.headers, host: `${target.host}:${target.port}` } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  p.on('error', () => { res.writeHead(502); res.end('proxy error'); });
  req.pipe(p);
}).listen(Number(process.env.PROXY_PORT ?? 54321), '127.0.0.1');
