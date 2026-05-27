import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const supabase = supabaseServer();
  await supabase.auth.signOut();
  const url = new URL(req.url);
  return NextResponse.redirect(`${url.origin}/`, { status: 303 });
}
