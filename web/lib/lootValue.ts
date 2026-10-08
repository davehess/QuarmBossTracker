// Shared by /admin/loot (server page and client table). Item values arrive in copper
// (eqemu_items.price); the page shows platinum, 1pp = 1000cp, up to one decimal.
export function fmtPp(cp: number | null | undefined): string {
  if (cp == null) return '—';
  return (cp / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 });
}
