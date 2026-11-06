import LocalReplay from './LocalReplay';
import HowIDied from './HowIDied';

export const metadata = {
  title: 'My replay · On this PC',
  description: 'Play back where you and your raid stood, and how you died, from the recording Mimic keeps on this PC.',
};

export default function ReplayPage() {
  return (
    <div className="space-y-4">
      <HowIDied />
      <LocalReplay />
    </div>
  );
}
