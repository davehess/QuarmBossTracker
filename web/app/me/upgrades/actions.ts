'use server';

// Server actions for the wishlist controls on /me/upgrades: add an upgrade to a character's wishlist with a
// priority and an optional sealed pre-bid, change or clear the pre-bid, remove it.
//
// The bid is never encrypted, stored or logged here. Each action proves the signed-in member owns the character
// (ownedCharacters), checks the same limits /wishlist add does (lib/wishlistRules.ts), and hands the request to
// the bot through lib/wishlistBot.ts, which encrypts with a key only the bot has. The bot re-checks ownership
// from the member's id, so nothing the browser sends is trusted on either side.
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { ownedCharacters } from '@/lib/ownedCharacters';
import { callBotWishlist } from '@/lib/wishlistBot';
import { parseBid, parsePriority } from '@/lib/wishlistRules';

export type WishlistResult = { ok: true } | { ok: false; error: string };

const fail = (error: string): WishlistResult => ({ ok: false, error });

/** The signed-in member's id and the canonical name of the character, if (and only if) it is theirs. */
async function ownCharacter(character: unknown, itemId: unknown): Promise<{ userId: string; name: string; itemId: number } | WishlistResult> {
  if (typeof character !== 'string' || !/^[A-Za-z]{2,}$/.test(character)) return fail('That character name is not one we can use.');
  if (typeof itemId !== 'number' || !Number.isInteger(itemId) || itemId <= 0) return fail('That item is not one we can use.');
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail('Sign in again to change your wishlist.');
  const mine = (await ownedCharacters(user.id)).find(o => o.name.toLowerCase() === character.toLowerCase());
  if (!mine) return fail('That is not one of your characters.');
  return { userId: user.id, name: mine.name, itemId };
}

const isFail = (v: { userId: string } | WishlistResult): v is WishlistResult => 'ok' in v;

async function finish(r: { ok: boolean; error?: string }): Promise<WishlistResult> {
  if (!r.ok) return fail(r.error ?? 'That did not save.');
  revalidatePath('/me/upgrades');
  return { ok: true };
}

/** Put an item on the character's wishlist. `bid` is whole DKP or null for none (the bot then bids 1 DKP at a drop). */
export async function addToWishlist(character: string, itemId: number, priority: number | null, bid: number | null): Promise<WishlistResult> {
  const prio = parsePriority(priority);
  if (!prio.ok) return fail(prio.error);
  const b = parseBid(bid);
  if (!b.ok) return fail(b.error);
  const own = await ownCharacter(character, itemId);
  if (isFail(own)) return own;
  return finish(await callBotWishlist(own.userId, { op: 'add', character: own.name, item_id: own.itemId, priority: prio.value, bid: b.value }));
}

/** Set, change or (null) clear the pre-bid on an item already on the wishlist. */
export async function setPreBid(character: string, itemId: number, bid: number | null): Promise<WishlistResult> {
  const b = parseBid(bid);
  if (!b.ok) return fail(b.error);
  const own = await ownCharacter(character, itemId);
  if (isFail(own)) return own;
  return finish(await callBotWishlist(own.userId, { op: 'setbid', character: own.name, item_id: own.itemId, bid: b.value }));
}

/** Take an item off the character's wishlist. */
export async function removeFromWishlist(character: string, itemId: number): Promise<WishlistResult> {
  const own = await ownCharacter(character, itemId);
  if (isFail(own)) return own;
  return finish(await callBotWishlist(own.userId, { op: 'remove', character: own.name, item_id: own.itemId }));
}
