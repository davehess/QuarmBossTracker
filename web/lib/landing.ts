// Where a member lands after signing in (the guild lead, 2026-10-31: "when they auth, I want it to be the page they land
// on if they went to the main page /"). Pure, so a test can run it; app/auth/callback/route.ts calls it AFTER its own
// safeNext() has made the target a safe same-origin path, so this never sees anything it must sanitise.
//
// Until the guild lead picks the hub the landing is a beta-only thing: the beta build lands on the variant and
// production keeps the home page. Graduating the hub flips HUB_LANDING to '/me' and drops the isBeta test.

export const HUB_LANDING = '/me?v=b';

/** `next` is the sanitised target ('/' when none was asked for, or the one asked for was thrown away). */
export function landingAfterSignIn(next: string, isBeta: boolean): string {
  return isBeta && next === '/' ? HUB_LANDING : next;
}
