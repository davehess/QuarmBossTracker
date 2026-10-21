/** @type {import('next').NextConfig} */
//
// The local site: the website's own pages, exported static (`out/`) and bundled into Mimic. The agent
// serves that folder under /local/ on the dashboard port (packages/wolfpack-logsync/index.js,
// `_serveLocalSite`), so the pages and their data both come from this PC. Nothing here may need a server:
// no cookies, no headers(), no route handlers, no next/image optimisation, no Supabase.
//
// It imports web/components and web/lib from the hosted site (tsconfig `@/*` -> the web root), so a page
// built here is the same code the website runs. Two consequences, both handled below:
//   - those files live OUTSIDE this app's folder, so Next must be told it may compile them (externalDir);
//   - they import `react`/`next/link` by bare name, and from web/components that walks up to web/node_modules,
//     which CI does not install for a Mimic build. resolve.modules puts THIS folder's node_modules first, so
//     one copy of React serves both, with or without web/node_modules present.
const path = require('path');

module.exports = {
  output: 'export',
  basePath: '/local',
  trailingSlash: true,              // /local/inventory/ -> out/inventory/index.html, which the agent can find
  images: { unoptimized: true },
  reactStrictMode: true,
  experimental: { externalDir: true },
  webpack(config, { webpack }) {
    config.resolve.modules = [path.join(__dirname, 'node_modules'), ...(config.resolve.modules || [])];
    // WpDbLink points at /db/<kind>/<id> on wolfpack.quest, a page this site does not have. Swap it for a
    // component that renders nothing, so the shared explorer stays byte-for-byte the hosted one. (A
    // replacement plugin, not resolve.alias: the `@/` path mapping resolves the request before an alias sees it.)
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(
      /[\\/]components[\\/]WpDbLink$/,
      path.join(__dirname, 'stubs', 'WpDbLink.tsx'),
    ));
    // The replay's 3D view needs a zone mesh the agent does not serve, and would ship three.js. The board is
    // mounted `bounded.flat` (no 2D/3D switch), so the dynamic import is swapped for a component that renders nothing.
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(
      /[\\/]Replay3D$/,
      path.join(__dirname, 'stubs', 'Replay3D.tsx'),
    ));
    return config;
  },
};
