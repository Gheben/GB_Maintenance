/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
      },
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '20%':      { transform: 'rotate(-14deg)' },
          '40%':      { transform: 'rotate(14deg)' },
          '60%':      { transform: 'rotate(-8deg)' },
          '80%':      { transform: 'rotate(8deg)' },
        },
      },
      animation: {
        wiggle: 'wiggle 0.45s ease-in-out',
      },
    },
  },
  plugins: [],
}
