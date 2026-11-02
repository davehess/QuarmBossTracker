// raidmimic.com/register: the interest form for a guild leader (the guild lead, 2026-11-01, option B: "a proper interest
// form, no sign-in"). Served at raidmimic.com/register (the middleware rewrites /register here) and, for preview, at
// wolfpack.quest/raidmimic/register and b.wolfpack.quest/raidmimic/register. Public, no sign-in, marked [beta]: a NEW
// page ships live with the tag (CLAUDE.md, DECISIONS §135). Same bare shell as the landing and set-up pages.
// The fields, the cleaning and the hourly limit are RegisterForm.tsx + actions.ts + lib/guildInterest.ts.
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import NewPageTag from '@/components/NewPageTag';
import { isRaidmimicHost, RAIDMIMIC_SETUP_PATH, raidmimicSeo } from '@/lib/raidmimicHost';
import { EQMIMIC_ORIGIN } from '@/lib/raidmimicLanding';
import { LANDING_PATH_ON_HOST, LANDING_PATH_ON_WOLFPACK, RELEASES_URL } from '@/lib/raidmimicSetup';
import RegisterForm from './RegisterForm';
import HostFrame from '@/components/RaidmimicFrame';

const TITLE = '[beta] Register your guild';
const DESCRIPTION =
  'Tell us about your raid guild: its game, size, raid nights and DKP tool. No sign-in and no account, just a way to count your guild in for Raid Mimic.';

// Indexed on the raidmimic apex hosts with https://raidmimic.com/register as the canonical address; noindex on the
// Wolf Pack hosts and on b.raidmimic.com (web/lib/raidmimicHost.ts raidmimicSeo()).
export function generateMetadata(): Metadata {
  return {
    title: { absolute: TITLE },
    description: DESCRIPTION,
    ...raidmimicSeo(headers().get('host'), '/register'),
    openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Raid Mimic', type: 'website' },
    twitter: { card: 'summary' },
  };
}

export default function RaidmimicRegisterPage() {
  const onHost = isRaidmimicHost(headers().get('host'));
  const landing = onHost ? LANDING_PATH_ON_HOST : LANDING_PATH_ON_WOLFPACK;
  const setup = onHost ? '/setup' : RAIDMIMIC_SETUP_PATH;

  return (
    <HostFrame onHost={onHost}>
    <div className="mx-auto max-w-xl pb-12">
      {/* On a raidmimic host /feedback is not a page, so the tag's link goes to the feedback form on eqmimic.quest. */}
      <NewPageTag note="New page: tell us about your guild." href={onHost ? `${EQMIMIC_ORIGIN}/feedback` : '/feedback'} />

      <header className="mb-5">
        <p className="text-xs uppercase tracking-widest text-gold">Raid Mimic</p>
        <h1 className="mt-1 text-3xl leading-tight text-text">Register your guild</h1>
        <p className="mt-3 max-w-[60ch] text-sm leading-6 text-text">
          Tell us about your raid and we will count your guild in. There is no sign-in and no account, and nothing is sent
          to your guild. Only the guild name is required.
        </p>
      </header>

      <RegisterForm downloadHref={RELEASES_URL} setupHref={setup} />

      <p className="mt-6 text-xs leading-6 text-dim">
        We keep what you type here, and a scrambled one-way form of your network address for one day, used only to limit how
        often one person can send. Links, email addresses and anything that looks like a password are removed before saving.{' '}
        <a href={landing}>Back to Raid Mimic</a>
      </p>
    </div>
    </HostFrame>
  );
}
