import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#F7F6F2',
        surface: 'rgba(255,255,255,0.70)',
        text: {
          primary: '#3A3A36',
          muted: '#6A6A64',
          subtle: '#A0A09A',
        },
        accent: '#A3B5A0',
        accent2: '#C89580',
        accent3: '#B0B8A8',
      },
      fontFamily: {
        sans: ['var(--font-urbanist)', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 400ms ease-out',
        'fade-in-up': 'fadeInUp 500ms ease-out',
        'fade-in-slow': 'fadeIn 800ms ease-out',
        'slide-up': 'slideUp 400ms ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
