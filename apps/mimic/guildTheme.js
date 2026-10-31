// The guild theme on the Mimic side (docs/DESIGN-theming.md section 4): what main.js accepts from the network and keeps
// in userData/brand/theme.json before it paints the overlays with it. Pure and electron-free so a test can require() it.
//
// The theme arrives from the guild's bot (the sign-in reply, then the agent's /api/state), so it is untrusted text:
// only the THEMABLE slots survive, each as a lowercase six-digit hex. The four meaning colours (green, red, gold,
// orange) are not in the list and can never be accepted, whatever the server sends. preload.js re-checks the same
// rules before it injects anything (a sandboxed preload cannot require this file), and a test holds the two equal.

const SLOTS = ['bg', 'panel', 'border', 'text', 'dim', 'accent', 'blue', 'purple'];
const FONTS = ['default', 'system-mono', 'sans', 'serif'];

function hex6(v) {
  const m = typeof v === 'string' ? v.trim().match(/^#?([0-9a-f]{6})$/i) : null;
  return m ? '#' + m[1].toLowerCase() : null;
}

// Anything -> { slots, font, logo_url, embed_color, updated_at }, or null when it is not a theme.
function clean(t) {
  if (!t || typeof t !== 'object') return null;
  const slots = {};
  const inSlots = t.slots && typeof t.slots === 'object' ? t.slots : {};
  for (const s of SLOTS) { const h = hex6(inSlots[s]); if (h) slots[s] = h; }
  const logo = typeof t.logo_url === 'string' ? t.logo_url.trim() : '';
  return {
    slots,
    font: FONTS.includes(t.font) ? t.font : 'default',
    logo_url: logo && logo.length <= 500 && /^https:\/\/[^\s"'()<>\\]+$/i.test(logo) ? logo : null,
    embed_color: hex6(t.embed_color),
    updated_at: typeof t.updated_at === 'string' ? t.updated_at.slice(0, 40) : null,
  };
}

module.exports = { SLOTS, FONTS, clean, hex6 };
