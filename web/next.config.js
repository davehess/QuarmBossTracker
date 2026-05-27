/** @type {import('next').NextConfig} */
//
// Host-based redirects for sibling subdomains on wolfpack.quest:
//   parser.wolfpack.quest   → GitHub raw download of the parser zip
//   discord.wolfpack.quest  → guild Discord invite (DISCORD_INVITE_URL env var)
//
// Each subdomain needs to be added in Vercel Dashboard → Domains, with a
// CNAME record at Porkbun pointing to `cname.vercel-dns.com`. Once the
// domain is attached to this project, the `has` host match below kicks in
// and Vercel issues the 308 redirect.
const PARSER_DOWNLOAD_URL =
  process.env.PARSER_DOWNLOAD_URL ||
  'https://raw.githubusercontent.com/davehess/QuarmBossTracker/main/releases/WolfPackParser.zip';

const DISCORD_INVITE_URL =
  process.env.DISCORD_INVITE_URL ||
  'https://discord.gg/VBCs6hCcau';

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
        permanent: false, // 307 so we can re-point at GitHub Releases later
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'discord.wolfpack.quest' }],
        destination: DISCORD_INVITE_URL,
        permanent: false,
      },
    ];
  },
};
