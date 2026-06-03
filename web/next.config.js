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
  'https://discord.gg/ubQ42TBmEN';

module.exports = {
  reactStrictMode: true,
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
