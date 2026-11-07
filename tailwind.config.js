/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // PNG-inspired palette: deep green field, red-black accents, warm gold
        pitch: {
          50: '#e8f5ec',
          100: '#c6e6cf',
          200: '#8fcd9f',
          300: '#57b470',
          400: '#2f9a4a',
          500: '#15803d',
          600: '#0f6633',
          700: '#0b4f28',
          800: '#073a1e',
          900: '#042414',
        },
        ember: {
          500: '#e53935',
          600: '#c62828',
          700: '#a52020',
        },
        gold: {
          400: '#f5c443',
          500: '#e6a817',
          600: '#c48a0e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Poppins', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
