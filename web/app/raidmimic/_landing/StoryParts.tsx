// Pieces shared by the raidmimic landing's `?v=c` (StoryStage) and `?v=d` (ChaptersStage) variants: the Discord sign-up button,
// the four features, the three pricing tiles. No client code of its own (SignInButton is the only client piece, and it is the
// same Discord sign-in the `?v=b` card uses: no new auth path). Words and numbers are in web/lib/raidmimicStory.ts.
import SignInButton from '@/components/SignInButton';
import { DOWNLOAD_URL } from '@/lib/raidmimicPlayer';
import { FEATURES, STORY_WORDS as W, TIERS, type Tier } from '@/lib/raidmimicStory';
import { PRIMARY_BTN } from './Parts';
import { ComingChip, FeaturePicture } from './StoryBits';

/** The gold sign-up button. `label` lets the same button read "Sign in" in a menu. */
export function SignUp({ label = W.signUp, className = PRIMARY_BTN }: { label?: string; className?: string }) {
  return <SignInButton next={W.after} label={label} className={`${className} disabled:opacity-60`} />;
}

/** `?v=c`: four short blocks, one picture and one sentence each. */
export function FeatureBlocks() {
  return (
    <section id="features" aria-label={W.featuresTitle} className="scroll-mt-4 pt-12">
      <h2 className="text-2xl text-[#f2ede1]">{W.featuresTitle}</h2>
      <ul className="m-0 mt-5 grid list-none gap-6 p-0 sm:grid-cols-2">
        {FEATURES.map((f, i) => {
          // An odd last block spans both columns, picture beside its words, so no block sits alone in a row.
          const wide = FEATURES.length % 2 === 1 && i === FEATURES.length - 1;
          return (
            <li key={f.id} className={`min-w-0 ${wide ? 'sm:col-span-2 sm:grid sm:grid-cols-2 sm:items-center sm:gap-6' : ''}`}>
              <FeaturePicture f={f} />
              <div className="min-w-0">
                <h3 className="mt-3 text-lg text-[#f2ede1]">{f.name}</h3>
                <p className="mb-0 mt-1 text-sm leading-6 text-text">{f.line}</p>
                {f.chip && <p className="mb-0 mt-2"><ComingChip>{f.chip}</ComingChip></p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const EDGE: Record<Tier['tone'], string> = { green: 'border-t-green', blue: 'border-t-blue', gold: 'border-t-gold' };

/** Free, Pro · Guild, Pro · Individual. The individual price comes from INDIVIDUAL_PRICE (null: "price at launch"). */
export function Pricing() {
  const tiers = TIERS();
  return (
    <section id="pricing" aria-label={W.pricingTitle} className="scroll-mt-4 pt-12">
      <h2 className="text-2xl text-[#f2ede1]">{W.pricingTitle}</h2>
      <p className="mb-0 mt-1 text-sm text-text">{W.pricingLead}</p>
      <ul className="m-0 mt-5 grid list-none gap-4 p-0 lg:grid-cols-3">
        {tiers.map(t => (
          <li key={t.id} data-tier={t.id} className="min-w-0">
            <article className={`flex h-full flex-col rounded-md border border-t-[3px] border-border bg-panel p-4 ${EDGE[t.tone]}`}>
              <h3 className="text-lg text-[#f2ede1]">{t.name}</h3>
              <p className="mb-0 mt-1 text-xl font-bold text-[#f2ede1]">{t.price}</p>
              <p className="mb-0 mt-1 text-xs text-dim">{t.note}</p>
              <ul className="m-0 mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-text marker:text-dim">
                {t.points.map(p => <li key={p}>{p}</li>)}
              </ul>
              {t.coming && <p className="mb-0 mt-3"><ComingChip>{t.coming}</ComingChip></p>}
              <div className="mt-auto pt-4">
                {t.id === 'free' && <a href={DOWNLOAD_URL} className={`${PRIMARY_BTN} w-full`}>Download Mimic</a>}
                {t.id === 'guild' && <SignUp className={`${PRIMARY_BTN} w-full`} />}
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
