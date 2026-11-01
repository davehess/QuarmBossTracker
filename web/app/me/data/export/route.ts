// GET /me/data/export: "Download my data" (the guild lead, 2026-11-01). The handler is web/lib/selfDataRoute.ts.
import { handleExport } from '@/lib/selfDataRoute';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(_request: Request) {
  return handleExport();
}
