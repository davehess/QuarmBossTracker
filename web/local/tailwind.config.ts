import type { Config } from 'tailwindcss';
import base from '../tailwind.config';

// The website's palette and fonts, so the two read as one product; only where the classes are SCANNED
// differs: this app, plus the shared components and the explorer it reuses.
const config: Config = {
  ...base,
  content: [
    './app/**/*.{ts,tsx}',
    '../components/**/*.{ts,tsx}',
    '../app/me/inventory/*.tsx',
  ],
};

export default config;
