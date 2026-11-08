'use client';

// The one piece of script in the admin sidebar: it marks the page you are on. It has to run in the browser because an
// App Router layout is not re-rendered when you move between two pages under it, so a highlight worked out on the
// server would stay on the first page you opened. Everything else in the shell (the groups, the counts, the mobile fold
// that is a plain <details>) is server-rendered HTML.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isCurrent } from '@/lib/adminShell';

export default function ActiveLink({ href, exact, soon, title, className, activeClassName, children }: {
  href: string; exact?: boolean; soon?: boolean; title?: string;
  className: string; activeClassName: string; children: React.ReactNode;
}) {
  const pathname = usePathname() || '';
  if (soon) {
    // A page that is not on this branch yet: shown, not followed.
    return <span title={title ? `${title} (coming soon)` : 'coming soon'} className={`${className} cursor-default opacity-50`}>{children}<span className="ml-1 text-[10px] text-dim">soon</span></span>;
  }
  const on = isCurrent(pathname, { href, exact });
  return (
    <Link href={href} title={title} aria-current={on ? 'page' : undefined} className={`${className} ${on ? activeClassName : ''}`}>
      {children}
    </Link>
  );
}
