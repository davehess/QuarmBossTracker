// GET /guilds/data/export/part?s=<section>: the same as /me/data/export/part, for raidmimic.com.
import { handlePart } from '@/lib/selfDataRoute';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  return handlePart(request);
}
