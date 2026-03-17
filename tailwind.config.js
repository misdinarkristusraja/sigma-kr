/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fdf2f2',
          100: '#fce4e4',
          200: '#fbcfcf',
          300: '#f79a9a',
          400: '#f26d6d',
          500: '#e94444',
          600: '#d62c2c',
          700: '#b31e1e',
          800: '#8B0000',
          900: '#7a0000',
          950: '#420000',
        },
        cream: {
          50:  '#fefef8',
          100: '#fdfde8',
          200: '#fafac5',
          300: '#f5f59a',
          400: '#eded6a',
          500: '#e2e23a',
          600: '#c9c921',
          700: '#9e9e18',
          800: '#7a7a18',
          900: '#616119',
        },
        liturgy: {
          green:  '#2d6a2d',
          red:    '#cc0000',
          white:  '#f8f0dc',
          purple: '#6b21a8',
          pink:   '#db2777',
          black:  '#1a1a1a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
