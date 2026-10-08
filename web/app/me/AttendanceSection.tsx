'use client';
// AttendanceSection — the raid-attendance block on /me, with the Strips /
// Blocks switch held as CLIENT state.
//
// The guild lead, 2026-09-13: "/me's page is having issues with raid attendance
// displaying from strips to blocks." The picker used to write the cookie and
// then re-render the page from the server — a router.replace plus a
// router.refresh, two full renders of a page that loads every character on
// the account. Both layouts are built from the same attendance data the page
// already has, so the switch is now local: the cookie is still written (the
// next fresh load starts on the chosen layout), nothing is fetched.

import { useState } from 'react';
import Link from 'next/link';
import RaidHeatmap, { type NightChip } from '@/components/RaidHeatmap';
import RaidNightsStrips, { type StripNight } from '@/components/RaidNightsStrips';
import RaidLayoutPicker from '@/components/RaidLayoutPicker';
import { pct, ATTENDED } from '@/lib/raidHeatmap';
import type { RaidLayout } from '@/lib/raidLayout';

export type AttendanceData = {
  chips: NightChip[];
  strips: StripNight[];
  held60: number;
  attended60: number;
  held30: number;
  attended30: number;
};

export default function AttendanceSection({ initial, attendance }: { initial: RaidLayout; attendance: AttendanceData }) {
  const [layout, setLayout] = useState<RaidLayout>(initial);
  return (
    <section data-tour="me-attendance" className="bg-panel border border-border rounded-lg p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl text-gold mb-1">📅 Raid attendance</h2>
          <p className="text-sm text-dim">
            Every raid night in the last 60 days, across all your characters.
            Gold means you were there (brighter = more of the night); an outline is a raid you missed.
            Click a night for its review.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Link href="/raidhistory" className="text-blue hover:underline text-sm whitespace-nowrap">
            📈 Guild raid history →
          </Link>
          <RaidLayoutPicker current={layout} onChange={setLayout} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
        <AttendanceStat label="Last 60 days" attended={attendance.attended60} held={attendance.held60} />
        <AttendanceStat label="Last 30 days" attended={attendance.attended30} held={attendance.held30} />
      </div>

      <div className="mt-4">
        {layout === 'strips' ? (
          <RaidNightsStrips nights={attendance.strips} label="Your raid attendance, one row per week, last 60 days" />
        ) : (
          <RaidHeatmap nights={attendance.chips} label="Your raid attendance, one square per raid night, last 60 days" />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-dim">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-[2px]" style={{ backgroundColor: ATTENDED }} />attended, every tick</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-[2px]" style={{ backgroundColor: ATTENDED, opacity: 0.5 }} />attended part of the night</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-[2px]" style={{ boxShadow: `inset 0 0 0 1px ${ATTENDED}` }} />missed</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-[2px] bg-border/40" />no raid</span>
      </div>
    </section>
  );
}

function AttendanceStat({ label, attended, held }: { label: string; attended: number; held: number }) {
  return (
    <div className="bg-bg border border-border rounded p-3">
      <div className="text-2xl text-gold">{held > 0 ? `${pct(attended, held)}%` : '—'}</div>
      <div className="text-dim text-xs">{label} · {attended} of {held} raids</div>
    </div>
  );
}
