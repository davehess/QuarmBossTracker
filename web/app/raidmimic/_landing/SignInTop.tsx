// The raidmimic landing's `?v=b` variant: "sign in first" (the guild lead picked sample A, 2026-10-31). It replaces the
// page's top (the headline with the video, and the three Player / Guild / Self-host doors) and nothing else: PathsLayout
// renders its feature grid, "See it run", "How it works", the small print and the footer under it as before.
//
//   - A slim header (brand, "for EverQuest raids", and "Already set up? Download Mimic" for people who have it).
//   - The hero: the pitch and the story video (MotionStage, as today) on the left, a sign-in card on the right.
//   - Under it three short doors by who is reading; each is the same arched card as today's doors, so the page keeps one look.
//
// Phone: the DOM order is pitch, the card, then the video, so the sign-in is on the first screen and the video follows it;
// from lg the card takes the right column (and stays in view beside the video as the page scrolls).
// MotionStage is not changed: it was built to own the whole width (a video in an `auto` column, a strip four across). In the
// narrower left column the two overrides on the wrapper below cap the video's box at the column and make the strip two
// across. If MotionStage's structure changes, the `?v=b` test in test/raidmimic-landing.test.js fails on them.
// Server component; the sign-in button and the video are the only client code. Every word is in raidmimicPlayer.ts.
import SignInButton from '@/components/SignInButton';
import { DOWNLOAD_URL, HERO, SIGNIN_FIRST as S, type Tone } from '@/lib/raidmimicPlayer';
import { PRIMARY_BTN, type Ctx } from './Parts';
import MotionStage from './MotionStage';

const ARCH: Record<Tone, string> = {
  free: 'border-t-green',
  hub: 'border-t-blue',
  choice: 'border-t-gold',
};

/** The sign-in button wears the page's gold, not Discord's blurple; it fills the card. */
const SIGNIN_BTN = `${PRIMARY_BTN} w-full disabled:opacity-60`;

const LINK = 'inline-flex min-h-11 items-center text-sm';

export default function SignInTop({ ctx }: { ctx: Ctx }) {
  return (
    <>
      <header className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border pb-2">
        <p className="m-0 text-lg font-bold uppercase tracking-wide text-[#f2ede1]">{S.brand}</p>
        <p className="m-0 text-sm text-dim">{S.tagline}</p>
        <p className="m-0 ml-auto text-sm text-dim">
          {S.already} <a href={DOWNLOAD_URL} className={`${LINK} underline`}>{S.download}</a>
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-x-10">
        <div className="lg:col-start-1">
          <h1 className="text-3xl leading-tight text-[#f2ede1] sm:text-5xl">{S.headline}</h1>
          <p className="mt-3 max-w-[60ch] text-base leading-7 text-[#f2ede1] sm:text-xl sm:leading-8">{S.pitch}</p>
        </div>

        <section aria-labelledby="signin-title"
          className="self-start rounded-lg border border-border bg-panel p-5 text-center lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <h2 id="signin-title" className="text-xl text-[#f2ede1]">{S.card.title}</h2>
          <p className="mt-1 text-sm leading-6 text-text">{S.card.lead}</p>
          <div className="mt-4"><SignInButton next={S.after} label={S.card.button} className={SIGNIN_BTN} /></div>
          <p className="mt-4 text-sm leading-6 text-text">{S.card.then}</p>
          <p className="mt-2 text-sm leading-6 text-text">
            {S.card.guest} <a href={S.guestPath} className="underline">{S.card.guestLink}</a>
          </p>
        </section>

        <div className="min-w-0 lg:col-start-1 lg:[&_[data-motion-stage]>div>div]:max-w-full lg:[&_[data-motion-stage]_ul]:grid-cols-2">
          <MotionStage />
        </div>
      </div>

      <section aria-label={S.doorsLabel} className="mt-2">
        <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-3">
          {S.doors.map(d => (
            <li key={d.id} id={`door-${d.id}`} className="scroll-mt-4">
              <article aria-labelledby={`door-${d.id}-name`}
                className={`flex h-full flex-col rounded-t-[2rem] rounded-b-md border border-t-[3px] border-border bg-panel px-4 pb-4 pt-6 sm:px-5 ${ARCH[d.tone]}`}>
                <h2 id={`door-${d.id}-name`} className="text-xl leading-tight text-[#f2ede1]">{d.name}</h2>
                <p className="mt-2 text-sm leading-6 text-text">{d.body}</p>
                {d.id === 'alone' && (
                  <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4">
                    <a href={DOWNLOAD_URL} className={PRIMARY_BTN}>{S.download}</a>
                    <a href={ctx.setup} className={LINK}>{HERO.setup} →</a>
                  </div>
                )}
              </article>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
