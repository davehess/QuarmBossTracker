/** @type {import('next').NextConfig} */
//
// Host-based redirects for sibling subdomains on wolfpack.quest:
//   parser.wolfpack.quest   → TinyURL pointing at the parser installer
//   discord.wolfpack.quest  → guild Discord invite (DISCORD_INVITE_URL env var)
//   mimic.wolfpack.quest    → /mimic route (auto-resolves latest beta release)
//
// These rules are duplicated in vercel.json so the redirect fires at the
// Vercel edge regardless of whether Next.js framework detection ran (we
// saw cases where next.config redirects didn't apply on prod). Keep both
// in sync.
//
// Each subdomain needs to be added in Vercel Dashboard → Domains, with a
// CNAME record at Porkbun pointing to `cname.vercel-dns.com`.
//
// Using TinyURL as the default destination so the target can be re-pointed
// without redeploying — set PARSER_DOWNLOAD_URL in Vercel to override.
const PARSER_DOWNLOAD_URL =
  process.env.PARSER_DOWNLOAD_URL ||
  'https://tinyurl.com/WolfPackP';

const DISCORD_INVITE_URL =
  process.env.DISCORD_INVITE_URL ||
  'https://discord.gg/VBCs6hCcau';

// b.wolfpack.quest — the beta mirror of the site. Put a `b.` in front of any
// page to see that page as it stands on the `beta` branch; the banner at the
// top says so and links back to the same path on production.
//
// Derived from the branch Vercel is BUILDING, not from the request host, so it
// is baked into the bundle and costs nothing at runtime (reading the Host
// header in the root layout would force every page to render dynamically).
// That works because beta is its own deployment: the `b.` domain is pinned to
// the beta branch in Vercel → Domains, so the beta build is the only one that
// domain ever serves.
//
// WP_FORCE_BETA=1 reproduces the banner on a local `next dev`.
const IS_BETA =
  process.env.VERCEL_GIT_COMMIT_REF === 'beta' ||
  process.env.WP_FORCE_BETA === '1';

module.exports = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_IS_BETA: IS_BETA ? '1' : '',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'www.pqdi.cc' },
      { protocol: 'https', hostname: 'cdn.discordapp.com' },
    ],
  },
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'parser.wolfpack.quest' }],
        destination: PARSER_DOWNLOAD_URL,
        permanent: false,
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'discord.wolfpack.quest' }],
        destination: DISCORD_INVITE_URL,
        permanent: false,
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'mimic.wolfpack.quest' }],
        destination: 'https://wolfpack.quest/mimic',
        permanent: false,
      },
    ];
  },
};
