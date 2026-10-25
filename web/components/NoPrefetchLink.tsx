'use client';
// next/link with automatic prefetching OFF unless a caller passes prefetch={true}. next.config.js points every
// `import Link from 'next/link'` in the app at this file, so the 130-odd files that use Link change nothing.
//
// Why (the guild lead, 2026-10-25, on Vercel's "75% of your free CPU" warning): Next prefetches every link that scrolls
// into view, and each prefetch runs the middleware (session check, page-view row) and a server render. Measured on
// page_views over 7 days: 8,785 of 10,653 signed-in page requests came in bursts of 3+ per second per member, i.e.
// prefetches, not reads. With this, a page is fetched when it is clicked, a moment slower and far cheaper.
import NextLink from 'next/dist/api/link';
import { forwardRef, type ComponentProps } from 'react';

const Link = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function Link({ prefetch = false, ...rest }, ref) {
  return <NextLink ref={ref} prefetch={prefetch} {...rest} />;
});

export default Link;
