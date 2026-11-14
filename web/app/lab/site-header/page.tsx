import LabFrame from '@/components/lab/LabFrame';
import HeaderDraft, { type HeaderKey, type HeaderOpen, type HeaderSize } from '@/components/lab/site-header/HeaderDraft';
import { MockAuth, MockSearch, MockTimezone, MockTour } from '@/components/lab/site-header/Mocks';
import { labVariant } from '@/lib/lab/registry';
import { draft } from '@/lib/lab/drafts/site-header';
import { LAB_GROUPS, LAB_MEMBER, LAB_NOWS, LAB_RECENT, type LabNowKey } from '@/lib/lab/fixtures/site-header';
import { raidPill } from '@/lib/siteHeaderView';

export const metadata = { title: '[draft] Top bar', description: 'Three versions of the wolfpack.quest top bar, shown at real pixel sizes with made-up data.' };

type Frame = { label: string; w: number; h: number; size: HeaderSize; folded: boolean; open?: HeaderOpen; path: string };

function frames(v: HeaderKey): Frame[] {
  const doorOpen = (id: string): HeaderOpen => (v === 'c' ? { kind: 'jump' } : { kind: 'group', id });
  return [
    { label: 'Desktop 1440, top of page', w: 1440, h: 200, size: 'wide', folded: false, path: '/parses' },
    { label: 'Desktop 1440, folded (scrolled)', w: 1440, h: 540, size: 'wide', folded: true, open: doorOpen('stats'), path: '/parses' },
    { label: 'Half monitor 960', w: 960, h: 200, size: 'mid', folded: false, path: '/boards' },
    { label: 'Half monitor 960, account menu open', w: 960, h: 540, size: 'mid', folded: false, open: { kind: 'account' }, path: '/boards' },
    { label: 'Phone 412, closed', w: 412, h: 200, size: 'phone', folded: false, path: '/boards' },
    { label: 'Phone 412, menu open', w: 412, h: 700, size: 'phone', folded: false, open: doorOpen('raid'), path: '/boards' },
  ];
}

export default function Page({ searchParams }: { searchParams?: { v?: string; bare?: string; now?: string } }) {
  const current = labVariant(searchParams?.v, draft) as HeaderKey;
  const nowKey: LabNowKey = (searchParams?.now && searchParams.now in LAB_NOWS ? searchParams.now : 'before') as LabNowKey;
  const now = LAB_NOWS[nowKey];
  return (
    <LabFrame draft={draft} current={current} bare={searchParams?.bare === '1'}>
      {current === 'b' && (
        <div className="mb-4 text-xs text-text">
          <div className="mb-1 text-text">The pill needs a clock. Pick the moment the frames pretend it is:</div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(LAB_NOWS) as LabNowKey[]).map((k) => (
              <a key={k} href={`/lab/site-header?v=b&now=${k}`} aria-current={k === nowKey ? 'page' : undefined}
                 className={`flex min-h-[40px] items-center rounded border px-3 no-underline ${k === nowKey ? 'border-accent bg-accent/20 text-text' : 'border-border text-text hover:bg-panel'}`}>
                {LAB_NOWS[k].label}: {raidPill(LAB_NOWS[k].iso).long}
              </a>
            ))}
          </div>
        </div>
      )}
      {(['member', 'officer'] as const).map((role) => (
        <section key={role} className="mb-10">
          <h2 className="mb-3 text-sm font-bold text-text">As {role === 'member' ? 'a member' : 'an officer (adds the Admin door)'}</h2>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-8">
            {frames(current).map((f) => (
              <figure key={f.label} className="m-0 max-w-full">
                <figcaption className="mb-1 text-xs text-text">{f.label}</figcaption>
                <div className="max-w-full overflow-x-auto">
                  <div className="relative box-content overflow-hidden border border-border bg-bg" style={{ width: f.w, minHeight: f.h }} data-frame={`${role}-${f.w}`}>
                    <HeaderDraft
                      variant={current} groups={LAB_GROUPS} showMe showAdmin={role === 'officer'}
                      authBadge={<MockAuth name={LAB_MEMBER} />} tour={<MockTour />} search={<MockSearch />} timezone={<MockTimezone />}
                      accountName={LAB_MEMBER} fixed={{ size: f.size, folded: f.folded, open: f.open }} path={f.path}
                      now={now.iso} recent={LAB_RECENT}
                    />
                    <div className="space-y-2 p-4" aria-hidden>
                      {[70, 92, 55, 80, 40].map((pc, i) => <div key={i} className="h-3 rounded bg-panel" style={{ width: `${pc}%` }} />)}
                    </div>
                  </div>
                </div>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </LabFrame>
  );
}
