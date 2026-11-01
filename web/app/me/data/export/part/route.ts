// GET /me/data/export/part?s=<section>: one section of "Prepare my data" (the guild lead, 2026-11-01). The handler is
// web/lib/selfDataRoute.ts; `s` only picks a table from a fixed list.
import { handlePart } from '@/lib/selfDataRoute';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  return handlePart(request);
}
