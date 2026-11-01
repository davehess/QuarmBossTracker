// "Your data": the signed-in member's own download and delete (the guild lead, 2026-11-01: self-serve before payments
// go live). One component for both homes: /me on wolfpack.quest, and /guilds on raidmimic.com (the only signed-in page
// that host serves). `exportHref` is the only thing that differs: the export routes (manifest + part) live under each
// page's own path so the raidmimic middleware lets them through. A server component with no data of its own: both
// buttons act on whoever is signed in, decided on the server (lib/selfData.ts).
import DeleteAccount from './DeleteAccount';
import PrepareData from './PrepareData';

export default function YourData({ exportHref }: { exportHref: string }) {
  return (
    <section id="your-data" aria-labelledby="your-data-h" className="scroll-mt-20 rounded-lg border border-border bg-panel p-4 sm:p-6">
      <h2 id="your-data-h" className="text-xl text-gold">Your data</h2>
      <p className="mt-1 text-sm text-dim">Take a copy of what this site holds about you, or delete your account. Both only ever touch your own data.</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded border border-border bg-bg p-3">
          <h3 className="text-sm text-text">Download my data</h3>          <p className="mt-1 text-xs leading-5 text-dim">
            One file: your characters, tells, uploads, settings and the guild records that are yours. It is put
            together here first, so you see how big it is before you save it. You can prepare it once every 10 minutes.
          </p>
          <div className="mt-3"><PrepareData exportHref={exportHref} /></div>
        </div>

        <div className="rounded border border-border bg-bg p-3">
          <h3 className="text-sm text-text">Delete my account</h3>
          <p className="mt-1 text-xs leading-5 text-dim">
            Removes your own data and your sign-in. The guild&rsquo;s raid records stay with the guild, unlinked from your Discord account.
          </p>
          <div className="mt-3"><DeleteAccount /></div>
        </div>
      </div>
    </section>
  );
}
