// Wolf Pack — public privacy statement. Linked from the global footer and
// (when the onboarding wiring lands) from the welcome DM. The canonical text
// lives in docs/PRIVACY.md; this page mirrors it so a guildmate can read it
// without leaving wolfpack.quest. Keep the two in sync — short enough that
// duplicating the prose beats setting up MD-to-JSX rendering.
//
// Rewritten 2026-09-25 from a code + database audit. Rule for editing: say
// what the software does TODAY. A promise goes in only once the code keeps it.

import Link from 'next/link';
import type { ReactNode } from 'react';

export const dynamic = 'force-static';

export const metadata = {
  title: 'Privacy — Wolf Pack EQ',
  description: 'Plain-words privacy statement for Mimic, the Discord bot and wolfpack.quest.',
};

const B = ({ children }: { children: ReactNode }) => <strong className="text-text">{children}</strong>;

function Section({ title, tone = 'orange', children }: { title: string; tone?: 'orange' | 'green'; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className={tone === 'green' ? 'text-lg text-green' : 'text-lg text-orange'}>{title}</h2>
      {children}
    </section>
  );
}

function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc pl-6 space-y-1.5">{children}</ul>;
}

// Stacked rows instead of a wide table: the page is read on phones.
function Rows({ rows }: { rows: { head: ReactNode; body: ReactNode }[] }) {
  return (
    <div className="divide-y divide-border border border-border rounded-lg bg-panel">
      {rows.map((r, i) => (
        <div key={i} className="px-4 py-2.5 sm:grid sm:grid-cols-[13rem_1fr] sm:gap-4">
          <div className="text-text">{r.head}</div>
          <div className="text-sm">{r.body}</div>
        </div>
      ))}
    </div>
  );
}

const SWITCHES: { name: string; where: string; does: string; doesnt: string }[] = [
  {
    name: 'Exclude from stats', where: '/me, per character',
    does: "Your Mimic stops uploading that character's fights, chat, buffs and similar; hidden from your /me stats, the raid review and the quartermaster.",
    doesnt: "Stop other raiders recording it; stop your live status; delete what's stored. Uploads can slip through for a moment after Mimic starts, before it has fetched your settings.",
  },
  {
    name: 'Exclude inventory', where: '/me',
    does: "Your Mimic stops uploading that character's inventory and spellbook; hides its gear page.",
    doesnt: 'Delete what was uploaded; hide the inventory and spellbook pages (you and officers still see the old data).',
  },
  { name: 'Tell relay', where: '/me', does: 'Off by default. On: tells upload, are stored and DM’d to you.', doesnt: 'Delete past tells when turned off.' },
  { name: 'Quest page: public', where: '/me', does: 'Shows your quest tracker to members — quest progress, keys and completed quests.', doesnt: 'Show your inventory lists on it — those need the inventory page to be public too.' },
  { name: 'Inventory page: public', where: '/me', does: 'Shows your inventory (bags and bank) and spellbook to members.', doesnt: '—' },
  { name: 'Unticking a character', where: 'Mimic’s setup screen', does: 'Mimic never opens that character’s log.', doesnt: 'Stop that character’s live status (it comes from Zeal, not the log).' },
  { name: 'Crash reports', where: 'Mimic tray', does: 'Off by default.', doesnt: '—' },
  { name: 'Start with Windows', where: 'Mimic tray', does: 'On by default.', doesnt: '—' },
  { name: 'Zeal update notices', where: 'Mimic Settings', does: 'Stops the twice-a-day check for a new Zeal.', doesnt: '—' },
  { name: 'Disconnect', where: 'Mimic', does: 'Stops everything going to our server.', doesnt: 'Delete what’s stored.' },
];

const RETENTION: [string, string][] = [
  ['Who targeted what', '1 day'],
  ['Raid roster with positions', 'about a day'],
  ['Buffs and debuffs seen landing', '7 days'],
  ['Per-hit parse detail', '7 days (the parse totals are kept)'],
  ['Threat snapshots', '30 days is the rule; the clean-up has fallen behind, so older ones exist today'],
  ['/who sightings', '60 days, plus the most recent sighting of each character, indefinitely'],
];

const PROCESSORS: [string, string, string][] = [
  ['Supabase', 'Our database and website sign-in', 'Everything on this page, including emails'],
  ['Railway', 'Runs the Discord bot and the upload server', "Everything that's uploaded passes through; its logs hold character names"],
  ['Vercel', 'Hosts wolfpack.quest', 'The pages you view'],
  ['Discord', 'Sign-in, the bot, channels and DMs', 'Relayed chat, parse cards, DMs, the roster'],
  ['GitHub', 'Code, Mimic downloads and updates; a few automated jobs with database access', 'Downloads, and whatever those jobs read'],
  ['OpenDKP (on Amazon Web Services)', 'Our DKP system', 'Character names, attendance, auctions and bids. We keep a copy of its auction and bid history, not encrypted'],
  ['Raid-Helper', 'Raid sign-ups', 'Discord id, name, class, notes'],
  ['Microsoft', 'Turns callout text into speech for the Discord voice channel', 'The callout text, which can name a player'],
  ['Public time servers', "Keep Mimic's clock right", 'Your IP address'],
  ["The guild lead's own server, reached over Tailscale", 'Backups and the archive', 'Everything, as below'],
  ['Anthropic (Claude AI coding assistants)', 'Building and fixing the platform', 'Those sessions can query the database, including private data such as tells, while they work'],
];

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl mx-auto space-y-8 leading-relaxed">
      <header className="border-b border-border pb-4">
        <h1 className="text-2xl text-gold">🐺 Wolf Pack — Privacy, in plain words</h1>
        <p className="text-xs text-dim mt-1">
          Last updated: 2026-09-25 · Questions? <code>#feedback</code> or{' '}
          <Link href="/me" className="text-blue hover:underline">/me</Link>{' '}for what we have on you.
        </p>
      </header>

      <Section title="The spirit">
        <p>
          This stuff exists to make raids easier to run when things get hectic — and to carry some of
          the load for the officers who prep at all hours. It is <B>not</B> here to grade anyone. We
          don&apos;t track who caused a wipe, and we never will. Parses are for coordination and a
          little friendly fun. Healers, tanks, DPS: a rough night is just a rough night. It&apos;s a
          game. Nobody here is &ldquo;not doing enough.&rdquo;
        </p>
      </Section>

      <section className="space-y-3 bg-panel border border-green/40 rounded-lg p-5">
        <h2 className="text-lg text-green">Our privacy practices — what we can promise today</h2>
        <p className="text-sm text-dim">Each of these was checked against the code on the date above.</p>
        <Bullets>
          <li>
            <B>Open source.</B> Every line of Mimic, the bot and this website is{' '}
            <a href="https://github.com/davehess/QuarmBossTracker" target="_blank" rel="noreferrer" className="text-blue hover:underline">public on GitHub</a>.
            You, or a friend who codes, can check anything on this page.
          </li>
          <li>
            <B>Private chat is filtered on your own PC first.</B> Officer chat, group chat, custom
            channels, <code>/say</code>, OOC, shouts and auctions are dropped on your machine before
            anything is sent. Tells are too, unless you turn tell relay on.
          </li>
          <li>
            <B>The sensitive things are off until you turn them on:</B> tell relay, crash reports,
            uploading old logs, UI backups, and attaching your log to feedback.
          </li>
          <li>
            <B>No selling, no ads, no third-party trackers.</B> wolfpack.quest loads no analytics,
            advertising or tracking scripts, and serves its own fonts (one diagram page is the
            exception — see <em>The website</em>).
          </li>
          <li>
            <B>Encrypted in transit and at rest.</B> Everything travels over HTTPS. The hosted database
            is encrypted on disk by its provider (Supabase). On Windows, Mimic keeps its sign-in token
            in Windows&apos; own encrypted storage. Sealed bids made with <code>/wishlist</code> and UI
            backups are encrypted again inside the database.
          </li>
          <li>
            <B>Members-only means members-only on the website.</B> Signing in admits only people in our
            Discord with a member role. Signed-out visitors see no member data, get no sign-in cookie and
            are not logged.
          </li>
          <li>
            <B>Plain words, kept current.</B> This page says what the software does today, including the
            parts we are not proud of yet (next section).
          </li>
        </Bullets>
      </section>

      <Section title="What we can't promise yet">
        <p>We would rather tell you than have you find out.</p>
        <Bullets>
          <li>
            <B>Most data has no deletion date.</B> A few things expire (see <em>How long we keep it</em>);
            everything else is kept until someone asks us to remove it.
          </li>
          <li><B>There is no self-serve download or delete.</B> You ask an officer, and it is done by hand.</li>
          <li>
            <B>Opt-outs stop future uploads, not past ones.</B> Switching something off does not delete
            what was already collected.
          </li>
          <li>
            <B>Other raiders&apos; Mimic records you too.</B> Your own settings control your own Mimic,
            not theirs (see <em>What other raiders&apos; Mimic records about you</em>).
          </li>
        </Bullets>
      </Section>

      <Section title="Is it a keylogger? Is it a virus?">
        <p><B>No — and you don&apos;t have to take our word for it.</B></p>
        <p><B>What Mimic reads.</B> EverQuest&apos;s files, and only for EverQuest:</p>
        <Bullets>
          <li>your EQ log files (and any old-log folders you point it at);</li>
          <li>Zeal&apos;s live data feed — your HP, mana, buffs, target, pet, zone and position, plus your group and raid;</li>
          <li>your EQ and Zeal settings and UI files, and the inventory, spellbook and Quarmy export files you create;</li>
          <li>Zeal&apos;s crash files, which it summarises on your own PC;</li>
          <li>the folders of GINA and EQLogParser, if you have them, so it can offer to import your triggers;</li>
          <li>the list of running programs, to see whether EverQuest is running.</li>
        </Bullets>
        <p>
          It <B>never</B> records keystrokes, captures your screen, or reads your browser, passwords or
          clipboard. It uses a few global hotkeys you set; that is not a keyboard hook.
        </p>
        <p><B>What Mimic changes on your PC.</B></p>
        <Bullets>
          <li>Installs for your Windows user only. No admin rights, no drivers, no services.</li>
          <li><B>Starts with Windows by default.</B> Turn it off: tray menu → <em>Start with Windows</em>.</li>
          <li>
            In your EQ folder, only when you click the button for it: installs or updates Zeal and UI
            packs, and adjusts <code>eqclient.ini</code> / <code>zeal.ini</code> (<em>Set up for me</em>).
          </li>
          <li>
            <B>On by default:</B> moves a large EQ log that has gone quiet into a <code>LogArchive</code>{' '}
            folder, so EQ starts a fresh one. Nothing is deleted. It also keeps a few local backups of{' '}
            <code>eqclient.ini</code>.
          </li>
          <li>Two optional buttons ask for admin through the normal Windows prompt: adding a Defender exclusion, and fixing the Windows clock.</li>
          <li>It stops another program only when you click <em>retire the old Parser</em>.</li>
          <li>Uninstalling removes Mimic, not the changes above that you made in your EQ folder.</li>
        </Bullets>
        <p>
          <B>Who Mimic talks to:</B> our guild&apos;s server; GitHub (updates for Mimic, and for Zeal and
          UI packs); public internet time servers (Microsoft, the NTP Pool and Cloudflare), so raid
          timers line up; and, only if you sign in to OpenDKP through it, Amazon&apos;s sign-in service,
          which OpenDKP uses.
        </p>
        <p className="text-sm">
          <B>Verify it yourself:</B> scan the installer on{' '}
          <a href="https://www.virustotal.com" target="_blank" rel="noreferrer" className="text-blue hover:underline">VirusTotal</a>{' '}
          (an unsigned installer can trip one or two over-cautious scanners); read the code; open the
          local dashboard, which shows how many items each stream is waiting to send. The
          pending-upload file is plain text you can open. Your live status goes out directly, so it
          never sits in that file.
        </p>
        <p className="text-sm text-dim">
          The <B>&ldquo;unknown publisher&rdquo;</B> warning means the installer isn&apos;t code-signed.
          That costs money we haven&apos;t spent; it says nothing about safety.
        </p>
        <p className="text-sm text-dim">
          The older standalone Parser (<code>Parser.bat</code>) works like Mimic, but keeps its token in a
          plain-text file in your EQ folder and sets itself up to start when you log in to Windows.
        </p>
      </Section>

      <Section title="What leaves your PC">
        <p>
          Nothing goes to our server until you sign Mimic in with Discord. Every upload then carries a
          personal token tied to your Discord account. <B>Signing Mimic out (<em>Disconnect</em>) stops
          every upload to our server.</B>
        </p>
        <p><B>Sent by default once you are signed in:</B></p>
        <Bullets>
          <li><B>Fights:</B> damage, heals and deaths for everyone in the fight, pets included.</li>
          <li><B>Guild and raid chat</B> (<code>/gu</code>, <code>/rs</code>), with each speaker&apos;s class, level and race.</li>
          <li>
            <B><code>/who</code> results:</B> every player shown who is level 50+ or anonymous,{' '}
            <B>from any guild</B> — name, level, class, race, guild and zone.
          </li>
          <li>
            <B>Your live status</B>, every few seconds while Zeal is connected: zone, position (x/y/z),
            HP, mana, buffs, target, pet and what is hitting you. This goes out{' '}
            <B>in or out of a raid, and even with EQ logging off</B>.
          </li>
          <li>
            <B>The raid roster</B> while you are in a raid: every raid member — including people from
            other guilds — with class, level, group, HP and position.
          </li>
          <li>
            Buffs and debuffs you see land; your casts; threat; guild trigger callouts;{' '}
            <code>/sll</code> lockouts; boss kills; PvP kills; faction; your PoP flags;{' '}
            <code>/random</code> rolls; what you loot.
          </li>
          <li>Your inventory, spellbook and Quarmy exports, if the files exist.</li>
          <li>Housekeeping: app versions, your main character, zone and a clock check.</li>
        </Bullets>
        <p>
          <B>Only if you turn them on:</B> tell relay, crash reports, uploading old logs, UI backups, and
          attaching your log to feedback.
        </p>
        <p>
          <B>Never sent as chat:</B> officer chat, group chat, custom channels (including the guild&apos;s
          tag channel), <code>/say</code>, OOC, shouts, auctions, and tells unless you turn tell relay on.
          The one exception is a hail — see below.
        </p>
      </Section>

      <Section title="Tells">
        <Bullets>
          <li>
            <B>Off by default.</B> The switch is <B>tell relay on{' '}
            <Link href="/me" className="text-blue hover:underline">/me</Link></B>, per character.
          </li>
          <li>
            When it is on, your tells in both directions — including <B>the other person&apos;s
            words</B> — are uploaded, stored, and sent to you as a Discord DM. They are never posted to a
            channel, and on the website only you can see them.
          </li>
          <li>
            The person on the other side of the tell has not agreed to this. Please keep that in mind
            before you turn it on.
          </li>
          <li>Turning relay off stops new uploads; it does not delete tells already stored.</li>
          <li>
            <B>Mimic also has a Tells setting (Off / Local / Synced), which isn&apos;t wired up yet.</B>{' '}
            It doesn&apos;t affect uploads — tell relay on /me is the switch that decides. Its description
            in Mimic still describes how it was planned to work, and we&apos;re updating it.
          </li>
        </Bullets>
      </Section>

      <Section title="Hails (the one /say exception)">
        <p>
          A <code>/say</code> line starting with <B>Hail</B> (<em>Brackwyn says, &lsquo;Hail, Seer Mal
          Nae&rsquo;</em>) gets past the filter, because hailing an NPC is how Planes of Power flags are
          granted, and the game shows the confirmation only to the person who got it. When someone{' '}
          <B>uploads old logs</B>, we store who hailed, up to 48 characters of what followed
          &ldquo;Hail&rdquo;, the zone, the time, and whose log saw it. Nothing else that was said. This
          is evidence of a possible flag, never proof, and is shown that way. A player greeting another
          player the same way (&ldquo;Hail, friend&rdquo;) is stored too — we can&apos;t tell them apart.
        </p>
      </Section>

      <Section title="What other raiders' Mimic records about you">
        <p>Even if you never install Mimic, raiders who run it record what their game shows them:</p>
        <Bullets>
          <li>your damage, heals and deaths in fights they&apos;re in;</li>
          <li>your guild and raid chat;</li>
          <li>your <code>/who</code> presence — <B>from any guild</B>, at level 50+ or anonymous;</li>
          <li>your HP and position while you&apos;re in a raid with them;</li>
          <li>buffs landing on you, your <code>/random</code> rolls, PvP kills, and hails.</li>
        </Bullets>
        <p>
          Your own opt-outs don&apos;t stop this — that was a deliberate choice, because the fight happened
          to everyone in it. If you want something removed, ask.
        </p>
      </Section>

      <Section title="Crash reports (off by default)">
        <p>
          Turn on <B>Share crash reports</B> in the tray menu. Mimic then sends, for each Zeal crash: the
          crash details Zeal writes (including your character and zone), your Windows version, memory and
          graphics card and driver, fingerprints of nine game files, and a summary Mimic works out from
          the memory dump. <B>The memory dump itself never leaves your PC.</B> Crashes older than 30 days
          are skipped the first time you turn it on, but older ones can still be sent later.
        </p>
      </Section>

      <Section title="Feedback">
        <p>
          The <Link href="/feedback" className="text-blue hover:underline">feedback form</Link> stores
          your message and, if you&apos;re signed in, your Discord id and nickname, and reposts it to our
          Discord <code>#feedback</code> thread. From Mimic you can tick <em>attach log</em>: up to 6,000
          recent lines go with it, after Mimic removes tells, group chat, officer chat and custom
          channels. The filter isn&apos;t perfect — guild and raid chat stay in, and some chat can slip
          through when Zeal&apos;s short-chat format is on — so <B>read the preview before you send</B>.
        </p>
      </Section>

      <Section title="The website (wolfpack.quest)">
        <Bullets>
          <li>
            <B>Signing in</B> uses Discord. We ask Discord who you are and which roles you have in our
            server, to check you&apos;re a member. Our sign-in provider also receives <B>your email</B>{' '}
            from Discord and stores it; we don&apos;t use it and never email you.
          </li>
          <li><B>Sign-in records:</B> each signed-in session keeps your IP address and browser type.</li>
          <li>
            <B>Page views:</B> while signed in, each page you open is logged (the page, the page you came
            from, your browser). Officers can see how often each member visits and when they were last
            on. Signed-out visits are not logged.
          </li>
          <li>
            <B>Cookies:</B> the sign-in cookie (lasts up to 400 days), and two preference cookies for your
            time zone and raid layout (1 year). Other preferences stay in your browser. No advertising or
            analytics cookies.
          </li>
          <li>
            <B>Third-party requests:</B> none on member pages except your Discord avatar, which loads from
            Discord. The diagrams on <code>/platform/architecture</code> load fonts from Google. The beta
            mirror (<code>b.wolfpack.quest</code>) loads a Vercel preview script.
          </li>
        </Bullets>
      </Section>

      <Section title="Who sees what">
        <ul className="space-y-2">
          {([
            ['ONLY YOU', 'bg-purple/20 text-purple border-purple/40', <>Your relayed tells; your <Link href="/me" className="text-blue hover:underline">/me</Link> page.</>],
            ['YOU + OFFICERS', 'bg-orange/20 text-orange border-orange/40', <>Your inventory, spellbook and quest pages. Officers can also upload inventory for any character. Two switches on /me share them with members, separately: <B>Quest page</B> and <B>Inventory page</B>.</>],
            ['GUILD', 'bg-green/20 text-green border-green/40', <>Signed-in members: parses, DKP and bids, attendance, loot, kill timers, <code>/who</code> sightings, and each character&apos;s equipped gear and AAs. Members&apos; Mimic can look up your current zone, HP and buffs — that&apos;s how the buff queue and Target Info work.</>],
            ['OFFICERS', 'bg-gold/20 text-gold border-gold/40', <>The admin pages cover all of it, including chat history, member page views and feedback.</>],
            ['DISCORD', 'bg-blue/20 text-blue border-blue/40', <>Whoever can read the channel: relayed guild and raid chat, parse cards (which name deaths), the night&apos;s damage leaderboard, deathrolls, PvP kills and feedback.</>],
            ['ANON', 'bg-panel text-dim border-border', <>Guild-wide totals with <B>no names</B> (&ldquo;the Pack summoned 4,000 stacks of food&rdquo;).</>],
          ] as [string, string, ReactNode][]).map(([tag, cls, body]) => (
            <li key={tag} className="flex items-start gap-3">
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono mt-1 shrink-0 w-28 text-center ${cls}`}>{tag}</span>
              <span>{body}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm">
          Your stats on <code>/me</code> only count from <B>when you joined us</B> (PvP kills are public
          server events, counted from the start).
        </p>
      </Section>

      <Section title="What your switches actually do">
        <Rows
          rows={SWITCHES.map((s) => ({
            head: <><B>{s.name}</B><div className="text-xs text-dim">{s.where}</div></>,
            body: (
              <>
                <div><span className="text-green">Does:</span> {s.does}</div>
                {s.doesnt !== '—' && <div className="mt-1"><span className="text-red">Doesn&apos;t:</span> {s.doesnt}</div>}
              </>
            ),
          }))}
        />
      </Section>

      <Section title="How long we keep it">
        <Rows
          rows={[
            ...RETENTION.map(([what, kept]) => ({ head: what, body: kept })),
            {
              head: <B>Everything else</B>,
              body: (
                <>
                  <B>No deletion date — kept until someone asks.</B> Chat, tells, parses, loot, rolls, crash
                  reports, feedback, page views, sign-in records, your last live status, and the Discord
                  member list (including people who have left).
                </>
              ),
            },
          ]}
        />
        <p>Two copies live outside the hosted database, both on a server the guild lead runs (not a cloud provider):</p>
        <Bullets>
          <li><B>Backups:</B> a full copy of the database every night, including sign-in records and emails, kept for 30 days.</li>
          <li>
            <B>Archive:</B> a permanent copy of what the hosted database deletes on the schedule above —
            positions, <code>/who</code> sightings, buffs and threat — plus chat, tells and page views.
          </li>
        </Bullets>
        <p className="text-sm">Anything posted to Discord stays there until someone deletes it in Discord.</p>
      </Section>

      <Section title="Who else handles it">
        <Rows
          rows={PROCESSORS.map(([who, why, gets]) => ({
            head: <><B>{who}</B><div className="text-xs text-dim">{why}</div></>,
            body: gets,
          }))}
        />
      </Section>

      <Section title="See it, fix it, remove it">
        <Bullets>
          <li>
            <B>See:</B> <Link href="/me" className="text-blue hover:underline">/me</Link> shows your
            characters, stats, tells and inventory. It doesn&apos;t yet show your email, page views,
            sign-in records, chat history, <code>/who</code> sightings, positions, hails, crash reports or
            feedback — ask and we&apos;ll pull them.
          </li>
          <li><B>Download:</B> no export yet. Ask.</li>
          <li>
            <B>Remove:</B> ask an officer (or <code>#feedback</code>). We remove it from the live database;
            the nightly backups age out within 30 days; the archive copy and anything already posted in
            Discord have to be cleaned up by hand, so say if you want those gone too.
          </li>
        </Bullets>
      </Section>

      <section className="bg-panel border border-border rounded-lg p-5">
        <p className="text-text">
          <strong>That&apos;s it.</strong> No selling, no ads, no leaderboards of who whispered whom. Just
          tools to help the Pack run smoother on a crazy night.
        </p>
      </section>

      <Section title="If your guild runs this">
        <p className="text-sm">
          Everything above applies to a deployment run for or by another guild exactly as it applies to
          ours. Five rules on top, written into the hosted terms:
        </p>
        <ul className="list-disc pl-6 space-y-1.5 text-sm">
          <li><B>Observations made under your deployment belong to your guild</B> — parses, timers, rosters, chat relays, everything your members&apos; clients upload.</li>
          <li>
            <B>Nobody operating the platform reads your guild&apos;s data without your express consent for a
            specific troubleshooting request.</B> Access is per incident, never standing; the support
            tooling is built so its output cannot carry your secrets or your members&apos; data.
          </li>
          <li><B>Anonymised aggregates only, computed inside your deployment</B> before anything leaves it — counts and totals, never names or characters.</li>
          <li>
            <B>Your <code>/who</code> observations are never ingested into anyone else&apos;s dataset.</B> A
            future per-person &ldquo;be known&rdquo; opt-in may let an individual publish their own
            presence; it will be that person&apos;s choice, never the guild&apos;s, and it does not exist
            today.
          </li>
          <li><B>No tenant&apos;s observations are merged into another&apos;s as fact.</B> Observations can be fabricated; separation is the protection.</li>
        </ul>
        <p className="text-sm text-dim">
          If you self-host under the free license, these are yours to keep for your own members; the
          software is built to make them the default.
        </p>
      </Section>
    </article>
  );
}
