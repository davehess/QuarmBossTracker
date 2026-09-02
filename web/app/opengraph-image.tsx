// The card Discord draws when someone pastes a wolfpack.quest link.
//
// This is the site's most-seen surface and it did not exist: the openGraph block
// declared no image at all, so every link the guild shared — and they share them
// constantly — unfurled as a bare line of text. Fixed as a generated card rather
// than a static PNG so it stays in the repo as code, on the real palette, and
// can never drift out of sync with a design token.
//
// ⚠ nodejs runtime, not edge: we read the Mimic mark off disk and inline it as a
// data URI. ImageResponse cannot fetch /public by path — there is no origin at
// build time — and an <img src="/mimic-logo.png"> here renders as nothing at all,
// silently, which is exactly the failure mode that produced the missing favicon.
import { ImageResponse } from 'next/og';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const alt = 'WolfPack.quest — build planner, parse history and loadout library for Project Quarm';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  const markData = fs.readFileSync(path.join(process.cwd(), 'public', 'mimic-logo.png'));
  const mark = `data:image/png;base64,${markData.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          // Centred as ONE block with a fixed gap, not space-between: with only
          // two children that pins them to opposite edges and leaves a dead band
          // through the middle of the card, which is the part Discord crops
          // hardest on a narrow window.
          justifyContent: 'center', gap: 64, padding: '64px 76px',
          // The site's own ground (#0d1117) with the gold accent bled in from the
          // top-left, matching the landing page's treatment rather than inventing
          // a second visual language for the one image everyone sees first.
          background: 'linear-gradient(135deg, #17130a 0%, #0d1117 46%, #0d1117 100%)',
          color: '#c9d1d9', fontFamily: 'ui-monospace, monospace',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <img src={mark} width={104} height={104} alt="" />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 62, fontWeight: 700, color: '#f2ede1', letterSpacing: '-0.02em' }}>
              WolfPack.quest
            </div>
            <div style={{ fontSize: 25, color: '#d29922', marginTop: 6 }}>
              Wolf Pack · Project Quarm
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 38, color: '#c9d1d9', lineHeight: 1.28, maxWidth: 940 }}>
            Build planner, parse history and loadout library.
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 22, color: '#6e7681' }}>
            {['Parses', 'Raid board', 'Loadouts', 'Item DB', 'Mimic'].map((t) => (
              <div
                key={t}
                style={{
                  border: '1px solid #30363d', borderRadius: 7, padding: '7px 16px', display: 'flex',
                }}
              >
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
