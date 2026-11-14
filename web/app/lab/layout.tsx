// The design lab (b.wolfpack.quest/lab): draft designs with made-up data. Never indexed, on any host.
export const metadata = { robots: { index: false, follow: false } };

export default function LabLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
