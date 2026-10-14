import type { Config } from 'tailwindcss';

/**
 * Design tokens. Charcoal neutrals (slate is remapped to a cool charcoal
 * scale so every surface in the app shares one temperature), violet as the
 * primary accent and electric blue as the secondary (cyan is remapped to it).
 */
const charcoal = {
  50: '#F5F5F9', 100: '#E9E9F1', 200: '#D2D1DE', 300: '#B5B4C8', 400: '#9C9BB2', 500: '#7A7992',
  600: '#5A596E', 700: '#3D3C4E', 800: '#262533', 900: '#18171F', 950: '#0E0E13',
};
const electric = {
  50: '#EEF4FF', 100: '#DBE7FF', 200: '#B9D2FF', 300: '#8DB6FF', 400: '#5F98FF', 500: '#3D7EFF',
  600: '#2B63E6', 700: '#244FBA', 800: '#214392', 900: '#1E3A74', 950: '#132346',
};

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: charcoal,
        cyan: electric,
        background: '#0E0E13',
        'background-alt': '#121219',
        surface: '#15151C',
        raised: '#1C1C25',
        card: '#17171F',
        line: '#2A2A37',
        accent: { DEFAULT: '#8B6CFF', blue: '#3D7EFF', cyan: '#5F98FF' },
        foreground: '#EEEDF5',
        muted: '#9C9BB2',
        faint: '#6C6B82',
        border: '#2A2A37',
      },
      fontFamily: {
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        lg: '0.625rem',
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 32px -18px rgba(0,0,0,0.7)',
        glow: '0 10px 30px -12px rgba(139,108,255,0.55)',
      },
      backgroundImage: {
        'peb-gradient': 'linear-gradient(115deg, #8B6CFF 0%, #5B6DFF 48%, #3D7EFF 100%)',
      },
      keyframes: {
        'pulse-glow': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'fade-in': 'fade-in 180ms ease-out',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
