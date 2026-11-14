// raidmimic.com: the player-first front door (the guild lead, 2026-10-18 option C "two doors", reshaped 2026-10-23: "less
// about me setting it up as a service ... more about here's what you get as a player, here's what you could have as a
// guild"). Served at the root of raidmimic.com / .net / .quest (middleware.ts rewrites there) and also at
// wolfpack.quest/raidmimic and b.wolfpack.quest/raidmimic. Public; signing in only swaps the video for the player's panel.
//
// One page: the "Story stage" (StoryStage.tsx; the guild lead picked C on 2026-11-01 from three previews, then refined it: "start
// truly as the only thing on the page, fit is the video, fade it into the background color. Slowly add the logos as we go into
// the video. Skip/hide at the bottom"). The video fills the first screen alone; under it come what you get, raid management,
// pricing, the Register-interest band and the footer. The earlier "Pick your path" page, the sign-in-first and Chapters previews
// and the `?v=` switch were deleted. Words are in web/lib/raidmimicStory.ts and web/lib/raidmimicLanding.ts; "coming" means
// coming, and the page never says otherwise.
//
// Search engines (2026-10-23): INDEXED on the raidmimic hosts only, with https://raidmimic.com/ as the canonical address;
// the same page on wolfpack.quest and b.wolfpack.quest is noindex. web/lib/raidmimicHost.ts raidmimicSeo() decides, per
// request, from the Host header. The Register-interest button opens the anonymous form on eqmimic.quest (there is no
// form or mailbox of ours), so that form's rules apply: its text is untrusted data that people review, nothing acts on
// it automatically (CLAUDE.md, AFB).
import { headers } from 'next/headers';
import { supabaseServer } from '@/lib/supabase-server';
import { discordIdOf } from '@/lib/lockout';
import { loadMine } from '@/lib/hubMine';
import HomePanelGate from './_landing/HomePanelGate';
import HomeDashboard from './_landing/HomeDashboard';
import { loadHomeGuilds } from '@/lib/hubGuildsLoad';
import { profileOf } from '@/lib/hubRegistry';
import type { Metadata } from 'next';
import { isRaidmimicHost, raidmimicSeo, RAIDMIMIC_DEMO_PATH, RAIDMIMIC_SETUP_PATH } from '@/lib/raidmimicHost';
import HeroSwitch from '@/components/lab/rm-first-screen/HeroSwitch';
import { EQMIMIC_FEEDBACK_PATH, EQMIMIC_ORIGIN, interestUrl } from '@/lib/raidmimicLanding';
import { DOWNLOAD_URL } from '@/lib/raidmimicPlayer';
import { CtaBand, Footer, type Ctx } from './_landing/Parts';
import StoryStage from './_landing/StoryStage';
import { FeatureBlocks, Pricing, RaidManagement } from './_landing/StoryParts';
import { HostBar } from '@/components/RaidmimicFrame';

const TITLE = 'Raid Mimic · free EverQuest raid overlays';
const DESCRIPTION =
  'Free, open-source overlays for your EverQuest raids, built from the log the game already writes: run it on your own, or add a guild hub for shared raid reviews, merged parses and a command center.';

export function generateMetadata(): Metadata {
  return {
    title: { absolute: TITLE },
    description: DESCRIPTION,
    ...raidmimicSeo(headers().get('host'), '/'),
    openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Raid Mimic', type: 'website' },
    twitter: { card: 'summary' },
  };
}

// The top of the page (the guild lead picked "Home panel" on the Decision Desk, 2026-11-09): a signed-out visitor gets the story
// stage with a big Skip (remembered per viewer; "Rewatch the video" on the collapsed bar, via #video); a signed-in one (a
// Discord id on the session) gets the "Your Raid Mimic" panel instead of the video, with "Rewatch the video" revealing the
// stage in place. Neither reads a query.
export default async function RaidmimicPage() {
  // On a raidmimic host the form lives on eqmimic.quest and the page is `/`. On the Wolf Pack hosts the form is
  // reached by its real path, so the site header stays above the page.
  const onHost = isRaidmimicHost(headers().get('host'));
  const ctx: Ctx = onHost
    ? { onHost, interest: interestUrl(`${EQMIMIC_ORIGIN}/feedback`), setup: '/setup' }
    : { onHost, interest: interestUrl(EQMIMIC_FEEDBACK_PATH), setup: RAIDMIMIC_SETUP_PATH };
  const { data: { user } } = await supabaseServer().auth.getUser();
  const discordId = discordIdOf(user);
  const signedIn = !!(user && discordId);
  let top = <StoryStage downloadUrl={DOWNLOAD_URL} onHost={onHost} />;
  if (signedIn) {
    // The Dashboard (the guild lead picked option B, 2026-11-09): who you are, your characters, your guilds, Mimic.
    const [mine, guilds] = await Promise.all([loadMine(discordId!), loadHomeGuilds(discordId!)]);
    const { displayName, avatarUrl } = profileOf(user!);
    top = <HomePanelGate downloadUrl={DOWNLOAD_URL} onHost={onHost}
      panel={<HomeDashboard name={displayName} avatarUrl={avatarUrl} mine={mine} guilds={guilds} downloadUrl={DOWNLOAD_URL} />} />;
  }
  // Signed out: ?hero=a|b|c shows a first-screen draft instead (HeroSwitch; no ?hero= leaves `top` exactly as it is).
  if (!signedIn) {
    top = <HeroSwitch enabled={!onHost} links={{ download: DOWNLOAD_URL, demo: onHost ? '/demo' : RAIDMIMIC_DEMO_PATH, setup: ctx.setup, register: ctx.interest }}>{top}</HeroSwitch>;
  }
  // The stage is outside the width cap so it can span the viewport; the page under it is a reading column. No query is read:
  // a raidmimic host drops every one in the middleware, and the Wolf Pack hosts show the same page.
  return (
    <div id="raidmimic-home">
      {/* Signed in, the bar comes FIRST (the guild lead, 2026-11-09: the bar sat under the panel). */}
      {signedIn && onHost && <div className="mx-auto max-w-5xl"><HostBar /></div>}
      {top}
      <div className="mx-auto max-w-5xl pb-12">
        {/* The bar the other raidmimic.com pages carry: it slides in under the stage and stays pinned (the guild lead,
            2026-11-02: "top bar on the raidmimic.com site doesn't lock"). The stage keeps its own header. */}
        {!signedIn && onHost && <HostBar />}
        <FeatureBlocks />
        <RaidManagement />
        <Pricing setup={ctx.setup} onHost={onHost} />
        <div className="mt-12"><CtaBand ctx={ctx} /></div>
        <Footer onHost={onHost} />
      </div>
    </div>
  );
}
