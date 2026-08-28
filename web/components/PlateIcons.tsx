// One drawn icon set, one stroke weight, one grid. Replaces the emoji the
// landing page used to lean on: an emoji renders differently on every OS and
// belongs to no design system, which makes it the fastest way to tell a
// visitor the page was assembled rather than built.
type IconProps = { className?: string };
const base = 'stroke-current fill-none';

function Frame({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round"
         className={`${base} ${className}`} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const IconParse = (p: IconProps) => (
  <Frame {...p}><path d="M3 16V8M7.5 16V4M12 16v-6M16.5 16v-9" /><path d="M2 18h16" /></Frame>
);
export const IconTimer = (p: IconProps) => (
  <Frame {...p}><circle cx="10" cy="11" r="6.4" /><path d="M10 7.6V11l2.6 1.7M7.6 2.6h4.8" /></Frame>
);
export const IconBlades = (p: IconProps) => (
  <Frame {...p}><path d="M3.4 3.4 12 12M16.6 3.4 8 12" /><path d="M6.2 16.4 8 12M13.8 16.4 12 12" /></Frame>
);
export const IconRank = (p: IconProps) => (
  <Frame {...p}><path d="M10 3.2 12 7.4l4.6.6-3.3 3.2.8 4.6L10 13.6 5.9 15.8l.8-4.6L3.4 8l4.6-.6Z" /></Frame>
);
export const IconMap = (p: IconProps) => (
  <Frame {...p}><path d="M2.8 5.4 7.4 3.4v11.2L2.8 16.6ZM7.4 3.4l5.2 2v11.2l-5.2-2ZM12.6 5.4l4.6-2v11.2l-4.6 2Z" /></Frame>
);
export const IconSpark = (p: IconProps) => (
  <Frame {...p}><path d="M10 2.4 11.6 8 17 9.8 11.6 11.6 10 17.2 8.4 11.6 3 9.8 8.4 8Z" /></Frame>
);
