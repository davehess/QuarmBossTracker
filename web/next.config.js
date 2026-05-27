/** @type {import('next').NextConfig} */
module.exports = {
  // Strict mode catches accidental double-renders in dev.
  reactStrictMode: true,
  // PQDI item images aren't on the page yet but we'll need this once they are.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'www.pqdi.cc' },
      { protocol: 'https', hostname: 'cdn.discordapp.com' },
    ],
  },
};
