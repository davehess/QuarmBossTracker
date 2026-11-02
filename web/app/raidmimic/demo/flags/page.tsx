// raidmimic.com/demo/flags: the demo guild's Planes of Power progress on the real gate table. Static: no database, no
// session, no request read (the fixture is web/lib/demoGuild.ts). The other gates are /demo/flags/<gate>.
import type { Metadata } from 'next';
import { DEMO_DEFAULT_GATE } from '@/lib/demoGuild';
import FlagsView from '../_parts/FlagsView';

export const metadata: Metadata = {
  title: { absolute: '[beta] Demo guild · Flags' },
  description: 'A demo guild’s Planes of Power progress, piece by piece, with flags a raid leader recorded for someone else shown as reported. Invented guild.',
  robots: { index: false, follow: false },
};

export default function DemoFlagsPage() {
  return <FlagsView gateKey={DEMO_DEFAULT_GATE} />;
}
