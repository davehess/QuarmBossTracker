// raidmimic.com/demo/flags/<gate>: the same table for any other gate. The gates are listed (generateStaticParams) and
// dynamicParams = false, so a made-up gate is a 404 and not a render.
import type { Metadata } from 'next';
import { DEMO_DEFAULT_GATE, GATE_CHOICES } from '@/lib/demoGuild';
import FlagsView from '../../_parts/FlagsView';

export const dynamicParams = false;

export function generateStaticParams() {
  return GATE_CHOICES.filter(g => g.key !== DEMO_DEFAULT_GATE).map(g => ({ gate: g.key }));
}

export function generateMetadata({ params }: { params: { gate: string } }): Metadata {
  const name = GATE_CHOICES.find(g => g.key === params.gate)?.name ?? 'Gate';
  return {
    title: { absolute: `[beta] Demo guild · ${name} flags` },
    description: `A demo guild’s progress toward ${name}, piece by piece, with flags recorded for someone else shown as reported. Invented guild.`,
    robots: { index: false, follow: false },
  };
}

export default function DemoGatePage({ params }: { params: { gate: string } }) {
  return <FlagsView gateKey={params.gate} />;
}
