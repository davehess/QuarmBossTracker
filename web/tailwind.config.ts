import type { Config } from 'tailwindcss';

// Dark palette mirrors the agent's local web dashboard so the two surfaces
// feel like the same product.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:     '#0d1117',
        panel:  '#161b22',
        border: '#30363d',
        text:   '#c9d1d9',
        dim:    '#6e7681',
        blue:   '#58a6ff',
        gold:   '#d29922',
        green:  '#56d364',
        red:    '#f85149',
        orange: '#ffa657',
        accent: '#1f6feb',
      },
      fontFamily: {
        mono: ['Cascadia Code', 'Consolas', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
