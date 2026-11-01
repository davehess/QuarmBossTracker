// Privacy · Terms · Refunds · Contact: the footer row of the raidmimic surfaces (the guild lead's pre-launch checklist,
// 2026-11-01). Inline links with dot separators, so it drops into any small-print paragraph. The addresses come from
// web/lib/legal.ts: the pages on a raidmimic host, their real paths on the Wolf Pack hosts, and the contact email as a mailto.
import { CONTACT_HREF, legalPaths } from '@/lib/legal';

export default function LegalLinks({ onHost }: { onHost: boolean }) {
  const p = legalPaths(onHost);
  const links: [string, string][] = [['Privacy', p.privacy], ['Terms', p.terms], ['Refunds', p.refunds], ['Contact', CONTACT_HREF]];
  return (
    <span data-legal-links>
      {links.map(([label, href], i) => (
        <span key={label}>
          {i > 0 && <><span aria-hidden>&middot;</span>{' '}</>}
          <a href={href}>{label}</a>{' '}
        </span>
      ))}
    </span>
  );
}
