import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // الألوان الرسمية لتطبيق مَقوتي (المطابقة لـ AppColors في أندرويد)
        primary: {
          DEFAULT: '#1C351D', // Forest Green
          dark: '#0F1F12',
          light: '#2E5530',
        },
        secondary: {
          DEFAULT: '#B3CD7C', // Olive Accent
          light: '#C7DC98',
          dark: '#9BB863',
        },
        accent: {
          DEFAULT: '#8BAE55', // زرعي نشط
          hover: '#759842',
        },
        app: {
          bg: '#F7FAF7',
          surface: '#FFFFFF',
          muted: '#EEF3EE',
          border: '#DCE5DC',
        },
        ink: {
          DEFAULT: '#1C351D',
          secondary: '#5D735E',
          muted: '#8E9E8F',
        },
        // توحيد brand ليتطابق مع الأخضر الغابي الرسمي
        brand: {
          50: '#F0F5F0',
          100: '#EEF3EE',
          200: '#DCE5DC',
          300: '#B3CD7C',
          400: '#8BAE55',
          500: '#2E5530',
          600: '#244426',
          700: '#1C351D',
          800: '#152916',
          900: '#0F1F12',
        },
        amber: {
          400: '#C7DC98',
          500: '#B3CD7C',
          600: '#8BAE55',
          700: '#5D735E',
        },
        cream: '#F7FAF7',
        muted: '#5D735E',
      },
      fontFamily: {
        display: ['Titr', 'Segoe UI', 'Tahoma', 'sans-serif'],
        sans: ['Segoe UI', 'Tahoma', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 16px 40px rgba(15, 31, 18, 0.07)',
      },
    },
  },
  plugins: [],
};

export default config;
