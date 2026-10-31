// The guild theme, pure half (docs/DESIGN-theming.md sections 2 and 4). No server imports, so the /admin/theme
// editor (a client component) and the root layout share one definition of "a valid theme" and "today's values".
//
// What a guild may change is a short list on purpose: the neutral surface colours, the two accents, one font
// family, a logo and the colour of neutral Discord embeds. The MEANING colours (green = good/kill, red = bad/dead,
// gold = DKP/top/warning, orange) are not here and never will be: a guild that repainted "dead" would break every
// overlay that tells a raider something at a glance.
//
// The site emits the theme as `--wp-<slot>: r g b;` triplets on <html>. A triplet, not a hex, because the token
// layer (web/app/tokens.css, on beta) maps Tailwind colours to `rgb(var(--wp-bg) / <alpha-value>)`, which only
// works with space-separated channels. Until that layer graduates to main the variables are inert.

export const THEME_SLOTS = ['bg', 'panel', 'border', 'text', 'dim', 'accent', 'blue', 'purple'] as const;
export type ThemeSlot = (typeof THEME_SLOTS)[number];

// Today's values (DESIGN-theming.md section 2). The seed row in
// supabase/migrations/20261031170000_guild_theme.sql carries the same hex.
export const DEFAULT_SLOTS: Record<ThemeSlot, string> = {
  bg:     '#0d1117',
  panel:  '#161b22',
  border: '#30363d',
  text:   '#c9d1d9',
  dim:    '#6e7681',
  accent: '#1f6feb',
  blue:   '#58a6ff',
  purple: '#a371f7',
};

export const SLOT_LABELS: Record<ThemeSlot, { label: string; hint: string }> = {
  bg:     { label: 'Background',   hint: 'The page behind everything' },
  panel:  { label: 'Panel',        hint: 'Cards and overlay rows' },
  border: { label: 'Border',       hint: 'Hairlines between things' },
  text:   { label: 'Text',         hint: 'Body text. Must stay readable on the background' },
  dim:    { label: 'Dim text',     hint: 'Labels and secondary text' },
  accent: { label: 'Brand accent', hint: 'Buttons and the guild colour' },
  blue:   { label: 'Link blue',    hint: 'Links and info' },
  purple: { label: 'Purple',       hint: 'Secondary highlight' },
};

// The fixed meaning colours, shown beside the editor so an officer sees what they cannot change.
export const FIXED_SLOTS: { name: string; hex: string; means: string }[] = [
  { name: 'green',  hex: '#56d364', means: 'good, kill' },
  { name: 'red',    hex: '#f85149', means: 'bad, dead, HP' },
  { name: 'gold',   hex: '#d29922', means: 'DKP, top, warning' },
  { name: 'orange', hex: '#ffa657', means: 'caution' },
];

// A short allow-list, never a free-text font name: a name is a request to load something, and the overlays are
// read mid-raid, so every option is a system stack that is already on the machine.
export const FONTS = {
  default:     { label: 'Cascadia (today)',  mono: "'Cascadia Code', Consolas, ui-monospace, monospace",              ui: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  'system-mono': { label: 'System mono',     mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",        ui: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  sans:        { label: 'Clean sans',        mono: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",        ui: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  serif:       { label: 'Classic serif',     mono: "Georgia, 'Times New Roman', serif",                               ui: "Georgia, 'Times New Roman', serif" },
} as const;
export type FontKey = keyof typeof FONTS;
export const FONT_KEYS = Object.keys(FONTS) as FontKey[];

// Discord's own blurple: what every neutral embed wears today.
export const DEFAULT_EMBED_COLOR = '#5865f2';

export type GuildTheme = {
  slots: Record<ThemeSlot, string>;   // lowercase '#rrggbb' for every themable slot
  logoUrl: string | null;             // https URL, or null for the built-in wolf
  font: FontKey;
  embedColor: string;                 // lowercase '#rrggbb'
};

export const DEFAULT_THEME: GuildTheme = {
  slots: { ...DEFAULT_SLOTS },
  logoUrl: null,
  font: 'default',
  embedColor: DEFAULT_EMBED_COLOR,
};

// ── Conversion ──────────────────────────────────────────────────────────────

const HEX6 = /^#?([0-9a-f]{6})$/i;

// '#1F6FEB' or '1f6feb' -> '#1f6feb'; anything else (3-digit, named, rgb(), junk) -> null.
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(HEX6);
  return m ? `#${m[1].toLowerCase()}` : null;
}

// '#1f6feb' -> '31 111 235', the form `rgb(var(--wp-x) / <alpha-value>)` needs.
export function hexToTriplet(hex: string): string | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  const n = parseInt(h.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

// WCAG contrast ratio of two hex colours (1 to 21); 0 when either is not a valid hex.
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const t = hexToTriplet(hex);
    if (!t) return null;
    const [r, g, bl] = t.split(' ').map(Number).map(c => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const la = lum(a), lb = lum(b);
  if (la == null || lb == null) return 0;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// Body text on the page background must clear this, or an officer could save a theme nobody can read (including
// the page that resets it). 3:1 is WCAG's floor for large text; the default pair is about 12:1.
export const MIN_TEXT_CONTRAST = 3;

// ── Validation ──────────────────────────────────────────────────────────────

// https only, no whitespace, quotes, parentheses, angle brackets or backslashes: the value is placed inside a
// CSS url("…"), so a character that could close it is refused rather than escaped.
const LOGO_RE = /^https:\/\/[^\s"'()<>\\]+$/i;
export const LOGO_MAX = 500;

export function validLogoUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > LOGO_MAX || !LOGO_RE.test(s)) return null;
  try { return new URL(s).protocol === 'https:' ? s : null; } catch { return null; }
}

export type ThemeErrors = Partial<Record<ThemeSlot | 'slots' | 'logoUrl' | 'font' | 'embedColor', string>>;

// STRICT: what an officer typed. Every field is checked and a bad one is named, never silently replaced.
// A missing slot is not an error (it means "today's value"); a present-but-bad one is.
export function validateThemeInput(raw: unknown): { ok: true; theme: GuildTheme } | { ok: false; errors: ThemeErrors } {
  const errors: ThemeErrors = {};
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const inSlots = (r.slots && typeof r.slots === 'object' ? r.slots : {}) as Record<string, unknown>;

  const slots = { ...DEFAULT_SLOTS };
  for (const s of THEME_SLOTS) {
    const v = inSlots[s];
    if (v == null || v === '') continue;
    const hex = normalizeHex(v);
    if (hex) slots[s] = hex; else errors[s] = 'Use a six-digit hex colour like #1f6feb.';
  }
  // A slot name outside the list (a meaning colour, or a typo) is refused, not ignored: the editor never sends one.
  for (const k of Object.keys(inSlots)) {
    if (!(THEME_SLOTS as readonly string[]).includes(k)) errors.slots = `"${k}" is not a themable slot.`;
  }

  let logoUrl: string | null = null;
  if (r.logoUrl != null && String(r.logoUrl).trim() !== '') {
    logoUrl = validLogoUrl(r.logoUrl);
    if (!logoUrl) errors.logoUrl = 'The logo must be an https:// address.';
  }

  let font: FontKey = 'default';
  if (r.font != null && r.font !== '') {
    if (typeof r.font === 'string' && (FONT_KEYS as string[]).includes(r.font)) font = r.font as FontKey;
    else errors.font = 'Pick a font from the list.';
  }

  let embedColor = DEFAULT_EMBED_COLOR;
  if (r.embedColor != null && r.embedColor !== '') {
    const hex = normalizeHex(r.embedColor);
    if (hex) embedColor = hex; else errors.embedColor = 'Use a six-digit hex colour like #5865f2.';
  }

  if (!errors.bg && !errors.text && contrastRatio(slots.text, slots.bg) < MIN_TEXT_CONTRAST) {
    errors.text = 'Text is too close to the background colour to read. Pick a lighter text or a darker background.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, theme: { slots, logoUrl, font, embedColor } };
}

// LENIENT: a stored row. A bad or missing field falls back to today's value for THAT field, so one corrupt value
// can never blank the site. Pure; no I/O.
export function normalizeStoredTheme(row: unknown): GuildTheme {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  const stored = (r.slots && typeof r.slots === 'object' ? r.slots : {}) as Record<string, unknown>;
  const slots = { ...DEFAULT_SLOTS };
  for (const s of THEME_SLOTS) slots[s] = normalizeHex(stored[s]) ?? DEFAULT_SLOTS[s];
  // The same readability floor on the way out: a row written by hand cannot make the site unreadable.
  if (contrastRatio(slots.text, slots.bg) < MIN_TEXT_CONTRAST) {
    slots.text = DEFAULT_SLOTS.text;
    slots.bg = DEFAULT_SLOTS.bg;
  }
  const font = typeof r.font === 'string' && (FONT_KEYS as string[]).includes(r.font) ? (r.font as FontKey) : 'default';
  return {
    slots,
    logoUrl: validLogoUrl(r.logo_url ?? r.logoUrl),
    font,
    embedColor: normalizeHex(r.embed_color ?? r.embedColor) ?? DEFAULT_EMBED_COLOR,
  };
}

// The shape written to the table (snake_case columns).
export function themeToRow(theme: GuildTheme) {
  return { slots: theme.slots, logo_url: theme.logoUrl, font: theme.font, embed_color: theme.embedColor };
}

// ── Emission ────────────────────────────────────────────────────────────────

// The custom properties for a theme, as a map. Only THEMABLE slots, never green/red/gold/orange.
// `changedOnly` drops everything equal to today's value, so a guild on the defaults emits nothing and its pages
// stay byte-identical to what they were before theming existed.
export function themeToCssVarMap(theme: GuildTheme, opts: { changedOnly?: boolean } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of THEME_SLOTS) {
    if (opts.changedOnly && theme.slots[s] === DEFAULT_SLOTS[s]) continue;
    const t = hexToTriplet(theme.slots[s]);
    if (t) out[`--wp-${s}`] = t;
  }
  if (!opts.changedOnly || theme.font !== 'default') {
    out['--wp-font-mono'] = FONTS[theme.font].mono;
    out['--wp-font-ui'] = FONTS[theme.font].ui;
  }
  if (theme.logoUrl) out['--wp-logo'] = `url("${theme.logoUrl}")`;
  return out;
}

// The same, as one declaration string: `--wp-bg: 13 17 23; --wp-panel: …;`
export function themeToCssVars(theme: GuildTheme, opts: { changedOnly?: boolean } = {}): string {
  return Object.entries(themeToCssVarMap(theme, opts)).map(([k, v]) => `${k}: ${v};`).join(' ');
}
