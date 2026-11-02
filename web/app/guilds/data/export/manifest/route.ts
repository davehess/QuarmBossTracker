// GET /guilds/data/export/manifest: the same as /me/data/export/manifest, for raidmimic.com. The middleware lets only the
// sign-in paths and /guilds through on that host (web/lib/raidmimicHost.ts), and /me is not one of them.
import { handleManifest } from '@/lib/selfDataRoute';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request) {
  return handleManifest();
}
