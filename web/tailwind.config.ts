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
        // Values live in app/tokens.css as RGB triplets (docs/DESIGN-theming.md §2); the names stay as they were.
        bg:     'rgb(var(--wp-bg) / <alpha-value>)',
        panel:  'rgb(var(--wp-panel) / <alpha-value>)',
        border: 'rgb(var(--wp-border) / <alpha-value>)',
        text:   'rgb(var(--wp-text) / <alpha-value>)',
        dim:    'rgb(var(--wp-dim) / <alpha-value>)',
        blue:   'rgb(var(--wp-blue) / <alpha-value>)',
        gold:   'rgb(var(--wp-gold) / <alpha-value>)',
        green:  'rgb(var(--wp-green) / <alpha-value>)',
        red:    'rgb(var(--wp-red) / <alpha-value>)',
        orange: 'rgb(var(--wp-orange) / <alpha-value>)',
        purple: 'rgb(var(--wp-purple) / <alpha-value>)',
        accent: 'rgb(var(--wp-accent) / <alpha-value>)',
      },
      fontFamily: {
        mono: ['var(--wp-font-mono)'],
      },
    },
  },
  plugins: [],
};

export default config;
