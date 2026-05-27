// Sign-in page. Shows a "Continue with Discord" button. The actual OAuth
// flow is initiated client-side via supabase.auth.signInWithOAuth so the
// browser owns the redirect chain. Returns here on error with ?error=...
import SignInButton from '@/components/SignInButton';

export const dynamic = 'force-dynamic';

export default function SignInPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string };
}) {
  const next = searchParams.next || '/';
  const error = searchParams.error;
  return (
    <div className="max-w-md mx-auto mt-12 space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6 text-center">
        <h2 className="text-xl text-gold mb-2">Sign in</h2>
        <p className="text-sm text-dim mb-6">
          The guild-wide views are gated to Wolf Pack members. Sign in with the
          Discord account you use in our server.
        </p>
        <SignInButton next={next} />
        {error && (
          <p className="text-red text-xs mt-4">
            {error}
          </p>
        )}
      </section>
      <p className="text-xs text-dim text-center">
        We only read your Discord ID and display name — no DMs, no other servers.
      </p>
    </div>
  );
}
