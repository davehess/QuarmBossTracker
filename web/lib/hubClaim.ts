// The claim rule for a player's character names on raidmimic.com. COPY of decideClaim in utils/hubSync.js (the web
// imports nothing from outside web/); test/hub-characters-import.test.js runs both on the same cases and fails if they
// disagree. Change one, change the other.
//
// An import as character X from a player CLAIMS X for that player (proof 'claimed'), except:
//   - Wolf Pack's characters table links X to a Discord id that is not this player's: refused (wolfpack_linked).
//   - another player already holds X as 'proven': refused (held_by_other).
//   - another player already holds X as 'claimed' or 'contested': both become 'contested'; the rows are stored.
// A row never goes DOWN: proven stays proven, contested stays contested.

export type Holder = { player_id: string; proof: string };
export type ClaimVerdict =
  | { verdict: 'refused'; reason: 'wolfpack_linked' | 'held_by_other' }
  | { verdict: 'claimed' | 'contested'; proof: string };

export function decideClaim(a: {
  playerId: string;
  discordId: string;
  wolfpackDiscordId?: string | null;
  holders?: Holder[] | null;
}): ClaimVerdict {
  const wolfpack = a.wolfpackDiscordId ? String(a.wolfpackDiscordId) : '';
  if (wolfpack && wolfpack !== String(a.discordId || '')) return { verdict: 'refused', reason: 'wolfpack_linked' };
  const rows = Array.isArray(a.holders) ? a.holders : [];
  const others = rows.filter(h => h && h.player_id !== a.playerId);
  const mine = rows.find(h => h && h.player_id === a.playerId);
  if (mine && mine.proof === 'proven') return { verdict: 'claimed', proof: 'proven' };
  if (others.some(h => h.proof === 'proven')) return { verdict: 'refused', reason: 'held_by_other' };
  if (others.length) return { verdict: 'contested', proof: 'contested' };
  if (mine) return { verdict: mine.proof === 'contested' ? 'contested' : 'claimed', proof: mine.proof || 'claimed' };
  return { verdict: 'claimed', proof: 'claimed' };
}
