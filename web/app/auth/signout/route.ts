import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { requestOrigin } from '@/lib/request-origin';

export async function POST(req: NextRequest) {
  const supabase = supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${requestOrigin(req)}/`, { status: 303 });
}
