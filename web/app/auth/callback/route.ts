// OAuth callback — Supabase Auth sends Discord users here with a ?code=...
// query param after consent. We exchange the code for a session cookie and
// redirect to the originally-requested page (or home).
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') || '/';

  if (code) {
    const supabase = supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${url.origin}/auth/signin?error=${encodeURIComponent(error.message)}`);
    }
  }

  return NextResponse.redirect(`${url.origin}${next}`);
}
