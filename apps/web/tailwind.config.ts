import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand: {
          DEFAULT: '#6366f1',
          2: '#8b5cf6',
          light: '#a78bfa',
        },
      },
      animation: {
        'float-slow': 'floatOrb 22s ease-in-out infinite',
        'float-mid':  'floatOrb 18s ease-in-out infinite -7s',
        'float-fast': 'floatOrb 14s ease-in-out infinite -13s',
        'blink': 'blink 1.1s step-end infinite',
        'shimmer': 'shimmer 3.5s ease-in-out infinite 1.5s',
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
      },
      keyframes: {
        floatOrb: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%':      { transform: 'translate(28px,-18px) scale(1.04)' },
          '66%':      { transform: 'translate(-16px,14px) scale(0.97)' },
        },
        blink: {
          '0%,100%': { opacity: '1' },
          '50%':     { opacity: '0' },
        },
        shimmer: {
          'to': { transform: 'translateX(210%)' },
        },
        pulseDot: {
          '0%,100%': { opacity: '1', transform: 'scale(1)' },
          '50%':     { opacity: '0.45', transform: 'scale(0.75)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
