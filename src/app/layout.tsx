import type { Metadata, Viewport } from 'next';
import { bodyFont, displayFont } from './fonts';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Prompt Engineering Battle', template: '%s · Prompt Engineering Battle' },
  description: 'SWAYAMBHU 2026 — the live prompt-engineering competition.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0E0E13',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${displayFont.variable} ${bodyFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
