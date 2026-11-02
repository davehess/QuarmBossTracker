// raidmimic.com/privacy: what the hosted Raid Mimic product stores, in plain words (the guild lead's pre-launch checklist,
// 2026-11-01). Served at raidmimic.com/privacy (the middleware rewrites /privacy here) and at wolfpack.quest/raidmimic/privacy.
// A NEW page, so it ships with the [beta] tag (CLAUDE.md, DECISIONS §135).
//
// The facts come from the Wolf Pack site's privacy statement (web/app/privacy/page.tsx), which was checked against the code on
// 2026-09-25 and is the longer, per-feature statement for Wolf Pack itself. This page restates everything a hosted guild and its
// members need and SENDS THEM NOWHERE ELSE (the guild lead, 2026-11-02: nothing on raidmimic.com references wolfpack.quest): the
// switches, what other raiders' Mimic records, the services a guild can connect and the whole retention table are written out
// below. test/raidmimic-no-wolfpack.test.js keeps the address out. RULE for editing it, the same as there: say what the software
// does TODAY, and say "coming" for what does not exist yet (hosting other guilds, payments). A promise goes in only once the
// code keeps it.
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { isRaidmimicHost, raidmimicSeo } from '@/lib/raidmimicHost';
import { CONTACT_EMAIL, CONTACT_HREF, LEGAL_META, MIN_AGE, YOUR_DATA_PATH, legalPaths } from '@/lib/legal';
import { REPO_URL } from '@/lib/raidmimicLanding';
import { B, Bullets, LEGAL_LINK, LegalShell, Rows, Section } from '../_legal/LegalParts';

export function generateMetadata(): Metadata {
  const { title, description } = LEGAL_META.privacy;
  return {
    title: { absolute: title },
    description,
    ...raidmimicSeo(headers().get('host'), '/privacy'),
    openGraph: { title, description, siteName: 'Raid Mimic', type: 'website' },
    twitter: { card: 'summary' },
  };
}

const EXT = { target: '_blank', rel: 'noreferrer' } as const;

const PROCESSORS: [string, string, string][] = [
  ['Supabase', 'The database and the sign-in', 'Everything stored for the service, including the email Discord gives it'],
  ['Railway', 'Runs the upload server and the Discord bot', 'Everything that is uploaded passes through; its logs can hold character names'],
  ['Vercel', 'Hosts the website', 'The pages you view'],
  ['Discord', 'Sign-in, the guild bot, channels and DMs', 'Whatever a guild has the bot post'],
  ['GitHub', 'The code, Mimic downloads and updates, and a few automated jobs', 'Downloads, and whatever those jobs read'],
  ['Public time servers', 'Keep Mimic’s clock right', 'Your IP address'],
  ['A server the Raid Mimic team runs', 'Backups and an archive', 'A copy of what the database holds, as below'],
  ['Anthropic (Claude AI coding assistants)', 'Building and fixing the platform', 'Those sessions can query the database, private data included, while they work'],
];

// Only when a guild connects them (the Wolf Pack site's list, restated here so this page stands on its own).
const IF_CONNECTED: [string, string, string][] = [
  ['OpenDKP (on Amazon Web Services)', 'The guild’s DKP system', 'Character names, attendance, auctions and bids. We keep a copy of its auction and bid history, not encrypted'],
  ['Raid-Helper', 'Raid sign-ups', 'Discord id, name, class, notes'],
  ['Microsoft', 'Turns callout text into speech for the Discord voice channel', 'The callout text, which can name a player'],
];

const KEPT: [string, string][] = [
  ['Who targeted what', '1 day'],
  ['Where your target stands (for your raid’s map)', 'Our server’s memory only, about 90 seconds'],
  ['Escort NPC trails (no player named)', '12 hours'],
  ['Raid roster with positions', 'About a day'],
  ['Raid positions kept for replay (one sample every few seconds)', 'Kept for now; the archive’s copy is permanent'],
  ['How each raider’s character looks on a raid night (race, worn armor and weapons)', 'Kept for now; the archive’s copy is permanent'],
  ['Raid voice recordings (only members who opted in)', 'Until the member opts out for tonight, or asks to be forgotten for everything'],
  ['Buffs and debuffs seen landing', '7 days'],
  ['Per-hit parse detail', '7 days (the parse totals are kept)'],
  ['Threat snapshots', '30 days is the rule; the clean-up has fallen behind, so older ones exist today'],
  ['Experience gained (with your group’s names)', '30 days'],
  ['/who sightings', '60 days, plus the latest sighting of each character'],
  ['Backups', '30 days'],
  ['Everything else', 'No deletion date today. Kept until you or your guild ask us to remove it.'],
];

// The switches a player has (the Wolf Pack site's list, restated here). Each says what it does and what it does not.
const SWITCHES: { name: string; does: string; doesnt: string }[] = [
  { name: 'Disconnect (in Mimic)', does: 'Stops everything going to our server.', doesnt: 'Delete what is stored.' },
  { name: 'Unticking a character (Mimic’s setup screen)', does: 'Mimic never opens that character’s log.', doesnt: 'Stop that character’s live status, which comes from Zeal, not the log.' },
  { name: 'Crash reports (Mimic’s tray)', does: 'Off by default.', doesnt: '' },
];

export default function RaidmimicPrivacyPage() {
  const onHost = isRaidmimicHost(headers().get('host'));
  const p = legalPaths(onHost);
  return (
    <LegalShell onHost={onHost} title="Privacy, in plain words"
      lead="What Raid Mimic keeps about you and your guild, who else touches it, and how to get it back or have it removed.">
      <Section title="The short version">
        <Bullets>
          <li>You sign in with <B>Discord</B>. We keep your Discord id, name and avatar.</li>
          <li><B>A guild owns its members’ raid records.</B> We hold them for the guild and follow its choices.</li>
          <li><B>No ads, no selling, no tracking scripts.</B> The site sets a sign-in cookie and two preference cookies, nothing more.</li>
          <li><B>Nothing you or your guild upload is ever used to train AI models.</B></li>
          <li>Not for children under {MIN_AGE}.</li>
          <li>Ask for your data any time: <a href={CONTACT_HREF} className={LEGAL_LINK}>{CONTACT_EMAIL}</a>.</li>
        </Bullets>
      </Section>

      <Section title="Who runs it">
        <p>
          The Raid Mimic team (“we”) runs Raid Mimic. It is a fan project, open source under the AGPL-3.0-or-later
          licence: <a href={REPO_URL} {...EXT} className={LEGAL_LINK}>every line is public</a>, so anything on this page can be checked.
          Questions go to <a href={CONTACT_HREF} className={LEGAL_LINK}>{CONTACT_EMAIL}</a>.
        </p>
        <p>
          <B>What is live today.</B> One guild, Wolf Pack, runs on this platform. Running other guilds
          is <B>coming</B>. This page is written for that hosted product so it is in place before the first other guild moves in.
          The free Mimic app on your own PC sends nothing to us until you sign it in.
        </p>
      </Section>

      <Section title="Your account">
        <Bullets>
          <li><B>Discord sign-in:</B> your Discord id, display name and avatar.</li>
          <li>
            <B>Your email.</B> Our sign-in provider receives it from Discord and stores it. We never use it and never email you.
          </li>
          <li><B>Sign-in records:</B> each session keeps your IP address and browser type.</li>
          <li>
            <B>Page views:</B> while you are signed in, each page you open is logged (the page, where you came from, your
            browser). Visits while signed out are not.
          </li>
          <li><B>Your guilds:</B> which guilds you belong to, your role in each, and the invite codes you used.</li>
          <li>
            <B>Find my guilds</B> asks Discord for your server list once, only when you press it. We match it against the guilds
            registered here and keep nothing else: not the list, not the names, not the token.
          </li>
          <li>
            <B>The interest form</B> stores what you type into it. People read it; nothing acts on it automatically.
          </li>
        </Bullets>
      </Section>

      <Section title="What a guild stores">
        <p>Once a guild runs on Raid Mimic, its members’ Mimic installs upload for that guild:</p>
        <Bullets>
          <li>fights: damage, heals and deaths for everyone in them, pets included;</li>
          <li>the raid roster and attendance, kills and timers, loot and rolls;</li>
          <li>live status while Zeal is connected: zone, position, HP, mana, buffs and target;</li>
          <li>guild and raid chat, <B>only if the guild uses chat relay</B>;</li>
          <li>anything else the guild connects: its DKP tool, sign-ups, the guild bot’s posts.</li>
        </Bullets>
        <p>
          Private chat never leaves your PC: officer chat, group chat, custom channels, <code>/say</code>, OOC, shouts, auctions
          and tells are dropped on your machine first. Signing Mimic out (<em>Disconnect</em>) stops every upload.
        </p>
      </Section>

      <Section title="What other raiders’ Mimic records about you">
        <p>Even if you never install Mimic, raiders who run it record what their game shows them:</p>
        <Bullets>
          <li>your damage, heals and deaths in fights they are in;</li>
          <li>your guild and raid chat;</li>
          <li>your <code>/who</code> presence, <B>from any guild</B>, at level 50+ or anonymous;</li>
          <li>your HP and position while you are in a raid with them;</li>
          <li>buffs landing on you, your <code>/random</code> rolls, PvP kills, and hails.</li>
        </Bullets>
        <p>
          Your own switches do not stop this. That was a deliberate choice, because the fight happened to everyone in it. If you
          want something removed, ask.
        </p>
      </Section>

      <Section title="What your switches actually do">
        <Rows rows={SWITCHES.map(s => ({
          head: <B>{s.name}</B>,
          body: <><div><span className="text-green">Does:</span> {s.does}</div>{s.doesnt && <div className="mt-1"><span className="text-red">Doesn’t:</span> {s.doesnt}</div>}</>,
        }))} />
      </Section>

      <Section title="Whose records they are">
        <p><B>The guild owns them. We process them for the guild.</B> We are the ones who look after your account; the guild decides
          what its records are for. What we promise a guild:</p>
        <Bullets>
          <li>Observations made under a guild belong to that guild.</li>
          <li>We look at a guild’s data only to fix a problem the guild has asked us about, one problem at a time.</li>
          <li>Anything combined across guilds is anonymised counts and totals, never names or characters.</li>
          <li>A guild’s <code>/who</code> observations are never added to anyone else’s data.</li>
          <li>One guild’s observations are never merged into another’s as fact.</li>
        </Bullets>
        <p>
          <B>An honest note.</B> Today the AI coding assistants we build with can query the database while they work, private
          data included. That is true now and it is on the list below, so you are not surprised by it.
        </p>
      </Section>

      <Section title="Who else handles it">
        <Rows rows={PROCESSORS.map(([who, why, gets]) => ({ head: <><B>{who}</B><div className="text-xs text-dim">{why}</div></>, body: gets }))} />
        <p>A guild that connects OpenDKP, Raid-Helper or the voice bot also sends those services what the connection needs:</p>
        <Rows rows={IF_CONNECTED.map(([who, why, gets]) => ({ head: <><B>{who}</B><div className="text-xs text-dim">{why}</div></>, body: gets }))} />
        <p>
          <B>Payments are coming.</B> When Pro billing opens, a payment company will take your card. We will name it here
          first, and we will never see or store your card number.
        </p>
      </Section>

      <Section title="How long we keep it">
        <Rows rows={KEPT.map(([what, kept]) => ({ head: what, body: kept }))} />
        <p>
          Two copies live outside the hosted database, both on a server the Raid Mimic team runs (not a cloud provider):
          <B> backups</B>, a full copy of the database every night, sign-in records and emails included, kept for 30 days; and
          an <B>archive</B>, a permanent copy of what the hosted database deletes on the schedule above, plus chat, tells and
          page views.
        </p>
        <p>Anything posted to Discord stays there until someone deletes it in Discord.</p>
      </Section>

      <Section title="Cookies">
        <p>
          One sign-in cookie (up to 400 days) and two preference cookies for your time zone and raid layout (1 year). No
          advertising cookies, no analytics, no third-party trackers. Your Discord avatar loads from Discord. The beta copies of
          the site also load a Vercel preview script.
        </p>
      </Section>

      <Section title="Never used to train AI models">
        <p>
          We do not use what you or your guild upload to train AI models, and we do not give it to anyone to do so. The AI
          assistants we build with are tools for writing code, as noted above.
        </p>
      </Section>

      <Section title="Age">
        <p>
          Raid Mimic is not for children under {MIN_AGE}. Discord’s own minimum age applies on top, and every sign-in goes
          through Discord. If you think a child under {MIN_AGE} has an account, write to us and we will remove it.
        </p>
      </Section>

      <Section title="See it, take it, remove it">
        <Bullets>
          <li>
            <B>Download and delete it yourself:</B> sign in and open{' '}
            <a href={YOUR_DATA_PATH} className={LEGAL_LINK}>Your data</a>. Delete removes your own data and your sign-in; a
            guild&apos;s raid records stay with the guild, unlinked from your Discord account.
          </li>
          <li>
            <B>Anything else</B> (see what we hold, fix it, remove it, ask a question):{' '}
            <a href={CONTACT_HREF} className={LEGAL_LINK}>{CONTACT_EMAIL}</a>. Wherever you live, ask; we will answer.
          </li>
          <li>
            <B>Your account is yours to delete. A guild’s records are the guild’s.</B> If you want your name taken out of a
            fight record a guild holds, write to us and we will take it to the guild’s owner.
          </li>
          <li>Backups age out within 30 days. Copies already posted in Discord have to be removed there.</li>
        </Bullets>
      </Section>

      <Section title="Changes">
        <p>
          When this page changes in a way that matters, the date at the top changes with it. The page is in the{' '}
          <a href={REPO_URL} {...EXT} className={LEGAL_LINK}>public repository</a>, so every earlier version is too. The{' '}
          <a href={p.terms} className={LEGAL_LINK}>Terms</a> and <a href={p.refunds} className={LEGAL_LINK}>Refunds</a> pages sit beside this one.
        </p>
      </Section>
    </LegalShell>
  );
}
