import LocalParses from './LocalParses';

export const metadata = {
  title: 'My parses · On this PC',
  description: 'Your own fights as this PC recorded them, and how they differ from the guild\'s merged record.',
};

export default function ParsesPage() {
  return <LocalParses />;
}
