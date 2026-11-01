// "By signing up you agree to the Terms and the Privacy policy": the one line under every Discord sign-up button on the
// raidmimic surfaces (the guild lead's pre-launch checklist, 2026-11-01). Signing in records the terms version
// (web/lib/termsAcceptance.ts), so the person has to have been shown this first. Plain markup, no hooks: it renders inside
// the server pages and inside the client story stage alike. `onHost` is isRaidmimicHost(Host header); it picks which
// address the two links use (web/lib/legal.ts legalPaths).
import { legalPaths } from '@/lib/legal';

// `privacy` overrides the Privacy link: Wolf Pack's own sign-in page points at its own /privacy, not at Raid Mimic's.
export default function AgreeLine({ onHost, privacy, className = 'mb-0 mt-2 text-xs leading-5 text-dim' }: { onHost: boolean; privacy?: string; className?: string }) {
  const p = legalPaths(onHost);
  return (
    <p data-agree-line className={className}>
      By signing up you agree to the <a href={p.terms} className="underline">Terms</a> and the{' '}
      <a href={privacy ?? p.privacy} className="underline">Privacy policy</a>
    </p>
  );
}
