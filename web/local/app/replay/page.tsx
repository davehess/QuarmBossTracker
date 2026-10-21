import LocalReplay from './LocalReplay';

export const metadata = {
  title: 'My replay · On this PC',
  description: 'Play back where you and your raid stood, from the recording Mimic keeps on this PC.',
};

export default function ReplayPage() {
  return <LocalReplay />;
}
