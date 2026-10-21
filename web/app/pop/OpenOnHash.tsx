'use client';

// Opens the <details> with this id when the address says #<id> — on arrival and when a same-page link is
// followed — so "full queue" in the progress sidebar lands on an OPEN card, not on a closed summary.
// Renders nothing; without script the link still scrolls to the summary line, one tap from the card.

import { useEffect } from 'react';

export default function OpenOnHash({ id }: { id: string }) {
  useEffect(() => {
    const open = () => {
      if (window.location.hash !== `#${id}`) return;
      const el = document.getElementById(id);
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView();
      }
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [id]);
  return null;
}
