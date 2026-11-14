'use client';
// Stand-ins for the slots the real layout passes in (search, tour, time zone, the sign-out badge). Made-up, no data.
export function MockSearch() {
  return <div className="flex h-9 w-[180px] items-center rounded border border-border bg-panel px-2 text-xs text-text">Search</div>;
}
export function MockTour() {
  return <button type="button" className="flex min-h-[40px] w-full items-center rounded px-3 text-left text-sm text-text hover:bg-border/50">Take the tour</button>;
}
export function MockTimezone() {
  return <div className="flex min-h-[40px] items-center justify-between px-3 text-sm text-text"><span>Time zone</span><span>Eastern</span></div>;
}
// Same shape as AuthBadge: name, then a Sign out button.
export function MockAuth({ name }: { name: string }) {
  return (
    <form className="flex items-center gap-2" onSubmit={(e) => e.preventDefault()}>
      <span className="hidden text-xs text-dim sm:inline">{name}</span>
      <button type="submit" className="rounded border border-border bg-panel px-2 py-1 text-xs hover:border-red">Sign out</button>
    </form>
  );
}
