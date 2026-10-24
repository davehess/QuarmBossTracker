// The game-account name is a login name, so the inventory page shows it masked until the
// owner clicks it (the guild lead, 2026-10-24). Keep the first two and last two characters
// around a fixed `***`; a name of four or fewer would leak most of itself, so it keeps one.
export function maskAccount(name: string): string {
  const chars = Array.from(name);
  if (chars.length === 0) return '';
  if (chars.length <= 4) return `${chars[0]}***`;
  return `${chars.slice(0, 2).join('')}***${chars.slice(-2).join('')}`;
}
