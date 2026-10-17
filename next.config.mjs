/** @type {import('next').NextConfig} */

const isProd = process.env.NODE_ENV === 'production';
// Vercel injects its feedback toolbar (vercel.live) into PREVIEW deployments
// only. Allow exactly the origins it documents there, never in production.
const isVercelPreview = process.env.VERCEL_ENV === 'preview';
const toolbar = (sources) => (isVercelPreview ? ` ${sources}` : '');

// Next.js App Router hydration needs inline scripts; everything else is
// locked to this origin. The browser never talks to Supabase or Gemini
// directly — all data goes through our own API routes.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}${toolbar('https://vercel.live')}`,
  `style-src 'self' 'unsafe-inline'${toolbar('https://vercel.live')}`,
  `img-src 'self' data: blob:${toolbar('https://vercel.live https://vercel.com')}`,
  `font-src 'self' data:${toolbar('https://vercel.live https://assets.vercel.com')}`,
  `connect-src 'self'${isProd ? '' : ' ws: wss:'}${toolbar('https://vercel.live wss://ws-us3.pusher.com')}`,
  `frame-src ${isVercelPreview ? 'https://vercel.live' : "'none'"}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src 'self' blob:",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isProd && process.env.ALLOW_HTTP !== 'true' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Gemini key and Supabase secret key must only ever be read server-side
  // (route handlers / server actions). Never prefix them with NEXT_PUBLIC_.
};

export default nextConfig;
