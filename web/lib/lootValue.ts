// Shared by /admin/loot (server page and client table). Item values arrive in copper
// (eqemu_items.price); the page shows platinum, 1pp = 1000cp, always to one decimal.
export function fmtPp(cp: number | null | undefined): string {
  if (cp == null) return '—';
  // Always one decimal, so a column of values lines up (the guild lead, 2026-10-09: "either show a decimal or not").
  return (cp / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
