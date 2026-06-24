/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Preserved verbatim from the inline tailwind.config in index.legacy.html.
        // Do not rename or revalue these — they are used throughout the component tree.
        bg:      '#07070f',
        surface: '#0f0f1c',
        card:    '#141425',
        border:  '#1e1e35',
        accent:  '#8b6cd8',
        text:    '#e8e8f4',
        muted:   '#6b6b90',
        ok:      '#22c55e',
        err:     '#f87171',
      },
    },
  },
  plugins: [],
};
