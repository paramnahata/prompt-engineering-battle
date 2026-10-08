import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#070B17',
        'background-alt': '#0B1020',
        surface: '#111827',
        card: '#151B2E',
        accent: {
          DEFAULT: '#7C3AED',
          blue: '#2563EB',
          cyan: '#22D3EE',
        },
        foreground: '#F8FAFC',
        muted: '#94A3B8',
        border: 'rgba(255,255,255,0.08)',
      },
      borderRadius: {
        lg: '0.75rem',
        xl: '1rem',
      },
      backgroundImage: {
        'peb-gradient':
          'linear-gradient(135deg, #070B17 0%, #0B1020 40%, #1E1B4B 100%)',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
