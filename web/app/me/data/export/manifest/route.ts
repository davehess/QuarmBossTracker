// GET /me/data/export/manifest: step one of "Prepare my data" (the guild lead, 2026-11-01). The handler is web/lib/selfDataRoute.ts.
import { handleManifest } from '@/lib/selfDataRoute';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request) {
  return handleManifest();
}
