// The legal pages' shared facts (the guild lead's pre-launch checklist, 2026-11-01): who to write to, which version of the
// terms is current, the minimum age, and where the legal pages live on each kind of host. Plain constants and two pure
// functions, no React and no network, so the pages, the sign-up lines, the footer and the tests all read ONE copy.
//
// ⚠ CONTACT_EMAIL is an address the guild lead still has to CREATE (a forwarding address on the raidmimic.com domain).
// Until it exists, mail sent to it bounces. Create it before the pages go to main; do not change the pages to hide it.
//
// ⚠ Changing TERMS_VERSION means the terms changed in a way people should agree to again: web/lib/termsAcceptance.ts
// writes one row per (user, version), so a new version is a new row the next time someone signs in. Bump LEGAL_UPDATED with it.

export const CONTACT_EMAIL = 'hello@raidmimic.com';
export const CONTACT_HREF = `mailto:${CONTACT_EMAIL}`;

export const TERMS_VERSION = '2026-11-01';
export const LEGAL_UPDATED = 'November 1, 2026';

/** The youngest person these services are for (the same floor Discord, which every sign-in goes through, sets). */
export const MIN_AGE = 13;

/** Where a signed-in person downloads or deletes their own data (being built; the pages say "coming" until it ships). */
export const YOUR_DATA_PATH = '/me#your-data';

export const PRODUCT = 'Raid Mimic';

// One title and sentence per page: the page's metadata and web/lib/pageMeta.ts (the card Discord shows) read the same words.
export const LEGAL_META = {
  privacy: {
    title: '[beta] Raid Mimic privacy',
    description: 'Plain words on what Raid Mimic stores about you and your guild, who else handles it, how long it is kept, and how to see it or have it removed.',
  },
  terms: {
    title: '[beta] Raid Mimic terms',
    description: 'The short, plain terms for using Raid Mimic: the free tier, Pro billing, what is not allowed, who owns what, and how an account can end.',
  },
  refunds: {
    title: '[beta] Raid Mimic refunds',
    description: 'How Pro billing, cancelling and refunds work for Raid Mimic: monthly only, first month free, cancel any time, and a refund on request within 7 days.',
  },
} as const;

export interface LegalPaths { home: string; privacy: string; terms: string; refunds: string }

/**
 * Where the legal pages are, from the visitor's side. On a raidmimic host (raidmimic.com and sisters) the middleware
 * serves them at the root; on wolfpack.quest and b.wolfpack.quest they are at their real paths. /terms is a real route
 * on both. `onHost` is isRaidmimicHost(Host header).
 */
export function legalPaths(onHost: boolean): LegalPaths {
  return onHost
    ? { home: '/', privacy: '/privacy', terms: '/terms', refunds: '/refunds' }
    : { home: '/raidmimic', privacy: '/raidmimic/privacy', terms: '/terms', refunds: '/raidmimic/refunds' };
}
