// A list that shows its first `limit` entries and keeps the rest one click away. The guild lead, 2026-10-14: "The
// (and 29 more) item isn't useful if we can't open it up." So there is no "and N more" in this folder that is not
// this component's <details>: the summary is the words, the panel is the names. Native element, no client JS, so it
// renders on the server and opens with the keyboard.

import type { ReactNode } from 'react';

export type ListItem = { key: string; node: ReactNode };

export default function ExpandList({ items, limit, noun = '', sep = ', ' }: { items: ListItem[]; limit: number; noun?: string; sep?: string }) {
  const head = items.slice(0, limit);
  const rest = items.slice(limit);
  const join = (list: ListItem[]) => list.map((it, i) => (
    <span key={it.key}>{i > 0 && sep}{it.node}</span>
  ));
  return (
    <>
      {join(head)}
      {rest.length > 0 && (
        <details className="mt-0.5">
          <summary className="cursor-pointer text-blue hover:underline">and {rest.length} more{noun}</summary>
          <div className="mt-0.5">{join(rest)}</div>
        </details>
      )}
    </>
  );
}
