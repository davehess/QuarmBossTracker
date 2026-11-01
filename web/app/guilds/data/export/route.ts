// GET /guilds/data/export: the same download as /me/data/export, for raidmimic.com. The middleware lets only the
// sign-in paths and /guilds through on that host (web/lib/raidmimicHost.ts), and /me is not one of them.
import { handleExport } from '@/lib/selfDataRoute';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_request: Request) {
  return handleExport();
}
