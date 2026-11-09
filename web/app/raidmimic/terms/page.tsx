// raidmimic.com/terms: the terms of service, short and plain (the guild lead's pre-launch checklist, 2026-11-01). Served at
// raidmimic.com/terms (the middleware rewrites /terms here), at wolfpack.quest/terms (web/app/terms/page.tsx re-exports this
// page, so that address stops being a 404) and at wolfpack.quest/raidmimic/terms. A NEW page: it ships with the [beta] tag.
//
// ⚠ Deliberately NO governing-law or venue clause. Which jurisdiction's law and courts apply is a lawyer's call, and a
// guessed one is worse than none. test/legal-pages.test.js holds that the words are not on the page.
// ⚠ Payments are not live (no billing code exists): the Pro section says "coming" and nothing is charged. Say it until it is
// not true. Version/date: web/lib/legal.ts. Changing the terms in a way people should agree to again means a new TERMS_VERSION.
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { isRaidmimicHost, raidmimicSeo } from '@/lib/raidmimicHost';
import { CONTACT_EMAIL, CONTACT_HREF, LEGAL_META, MIN_AGE, TERMS_VERSION, YOUR_DATA_PATH, legalPaths } from '@/lib/legal';
import { REPO_URL, RIGHTS_NOTICE } from '@/lib/raidmimicLanding';
import { GUILD_PRICE } from '@/lib/raidmimicStory';
import { B, Bullets, LEGAL_LINK, LegalShell, Section } from '../_legal/LegalParts';

export function generateMetadata(): Metadata {
  const { title, description } = LEGAL_META.terms;
  return {
    title: { absolute: title },
    description,
    ...raidmimicSeo(headers().get('host'), '/terms'),
    openGraph: { title, description, siteName: 'Raid Mimic', type: 'website' },
    twitter: { card: 'summary' },
  };
}

const EXT = { target: '_blank', rel: 'noreferrer' } as const;

export default function RaidmimicTermsPage() {
  const onHost = isRaidmimicHost(headers().get('host'));
  const p = legalPaths(onHost);
  return (
    <LegalShell onHost={onHost} showVersion title="Terms of service"
      lead="The short, plain rules for using Raid Mimic. Use it, and you agree to them.">
      <Section title="What this covers">
        <p>
          “The service” is the Raid Mimic website, the Mimic app, the Discord bot and the hosted guild features, and the Wolf Pack
          website that runs on the same platform. “We” is the Raid Mimic team. By signing up or using the service you agree to
          these terms and to the <a href={p.privacy} className={LEGAL_LINK}>Privacy policy</a>. If you do not agree, do not use it.
        </p>
        <p>You must be at least <B>{MIN_AGE}</B> years old. That is Discord’s minimum too, and every sign-in goes through Discord.</p>
      </Section>

      <Section title="The service, as it is">
        <Bullets>
          <li>
            <B>Free.</B> The Mimic app on your own PC is free and open source, with no account. We may change, pause or end a
            free feature. There is no promise of uptime.
          </li>
          <li>
            <B>As is.</B> It is a fan project built by volunteers. Parse numbers, timers and callouts can be wrong, and a
            game can change under it. Do not lean on it for anything that matters outside a game.
          </li>
          <li>
            <B>Hosting other guilds is coming.</B> Today one guild, Wolf Pack, runs on the platform.
          </li>
        </Bullets>
      </Section>

      <Section title="Pro plans and billing">
        <p><B>Payments are coming. Nothing is charged today, and nothing here bills you until billing opens.</B> When it does:</p>
        <Bullets>
          <li><B>Pro · Guild</B> is ${GUILD_PRICE} a month, monthly only, with the <B>first month free</B>.</li>
          <li>It renews every month until you cancel.</li>
          <li><B>Cancel any time, in one click.</B> You keep Pro until the end of the month you have paid for.</li>
          <li>A price change takes effect at a renewal after we have told you, never in the middle of a paid month.</li>
          <li>
            Going back to Free does not delete a guild’s records. Write to us if you want them removed. Refunds are on the{' '}
            <a href={p.refunds} className={LEGAL_LINK}>Refunds page</a>.
          </li>
        </Bullets>
      </Section>

      <Section title="Accounts and guilds">
        <Bullets>
          <li>You sign in with Discord. Keep your Discord account secure; what happens under it is on you.</li>
          <li>
            Whoever starts a guild owns it and answers for how it uses the service. <B>A guild owns the raid records its members
            upload to it.</B> We hold them for the guild (see the Privacy policy).
          </li>
          <li>A guild’s officers may pause a member inside that guild. That is the guild’s call, not ours.</li>
        </Bullets>
      </Section>

      <Section title="What you must not do">
        <Bullets>
          <li>Cheat, or break a game server’s rules, with it, or help someone hide from those rules.</li>
          <li>Harass, threaten or dox anyone, in a guild, a chat relay or anywhere the service shows names.</li>
          <li>Scrape the service, overload it, or try to get in where you were not let in.</li>
          <li>
            Upload other people’s private data: what only you were sent (tells, private chat), anyone’s passwords or tokens,
            or anything your own game client did not show you.
          </li>
          <li>Pretend to be someone else, or break the law with it.</li>
        </Bullets>
      </Section>

      <Section title="Your content and the guild’s records">
        <p>
          You keep what is yours. By uploading to the service you let us store it, process it and show it to the people your guild
          and its settings allow, for the one purpose of running the service. You promise it came from your own game client and
          that you may share it. We do not use it to train AI models.
        </p>
      </Section>

      <Section title="EverQuest belongs to Daybreak">
        <aside role="note" aria-label="Rights notice" className="rounded-md border border-gold/70 bg-panel p-4">
          <p className="m-0">{RIGHTS_NOTICE}</p>
        </aside>
      </Section>

      <Section title="The code is open">
        <p>
          The code is under the AGPL-3.0-or-later licence at <a href={REPO_URL} {...EXT} className={LEGAL_LINK}>the public
          repository</a>. That licence covers the code and lets you run your own copy. These terms cover the service we run.
        </p>
      </Section>

      <Section title="Ending an account">
        <Bullets>
          <li>
            <B>You can leave any time.</B> Delete your account yourself under{' '}
            <a href={YOUR_DATA_PATH} className={LEGAL_LINK}>Your data</a>, or write to{' '}
            <a href={CONTACT_HREF} className={LEGAL_LINK}>{CONTACT_EMAIL}</a>.
          </li>
          <li>
            <B>We can lock an account out</B> if it breaks these terms or puts the service or other people at risk. A locked-out
            account cannot sign in and its Mimic stops uploading. We say why when we can, and you can write to ask us to look
            again.
          </li>
        </Bullets>
      </Section>

      <Section title="No warranty, and limits on what we owe">
        <p>
          The service comes <B>as is and as available</B>, with no promise that it works, stays up, is accurate or suits your
          purpose. To the fullest extent the law allows, we are not responsible for indirect or lost-profit losses, or for lost
          loot, wiped raids or lost data. If we are found responsible for anything, what we owe is capped at what you paid us in
          the 12 months before it happened (for a free account, nothing). None of this limits a right you have by law that
          cannot be limited.
        </p>
      </Section>

      <Section title="Changes, and who to write to">
        <p>
          These are version <B>{TERMS_VERSION}</B>. When they change in a way that matters, the date and version at the top change,
          and signing in after that means you agree to the new ones. Questions, or anything you want us to look at:{' '}
          <a href={CONTACT_HREF} className={LEGAL_LINK}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>
    </LegalShell>
  );
}
