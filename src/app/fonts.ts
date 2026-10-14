import localFont from 'next/font/local';

/** Self-hosted (no third-party font requests; works with the strict CSP). */
export const displayFont = localFont({
  src: '../../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-standard-normal.woff2',
  variable: '--font-display',
  weight: '200 800',
  display: 'swap',
});

export const bodyFont = localFont({
  src: '../../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-standard-normal.woff2',
  variable: '--font-body',
  weight: '400 700',
  display: 'swap',
});
