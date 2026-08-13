// ItemIcon — one 40px cell out of the shipped icon atlas.
//
// Server-renderable: a styled <span>, no client JS, no <img> per icon. A loot
// list with 30 rows is 30 spans against ONE cached image rather than 30
// requests.
//
// Renders NOTHING when the atlas does not cover the icon (see ICON_LAST — the
// client ships art for 500..1723 while the catalog references up to 2000).
// Drawing an out-of-range cell would show a blank cropped from past the atlas
// edge, which reads as a broken image instead of "this item has no art".

import { itemIconStyle, hasItemIcon } from '@/lib/itemIcon';

export function ItemIcon({
  icon,
  size = 20,
  name,
  className = '',
}: {
  icon: number | null | undefined;
  size?: number;
  /** Item name, used for the accessible label. */
  name?: string;
  className?: string;
}) {
  const style = itemIconStyle(icon, size);
  if (!style) return null;
  return (
    <span
      className={className}
      style={style}
      // Decorative BESIDE a name, meaningful without one. The loot list always
      // prints the item name next to this, so announcing it again would just
      // make a screen reader say everything twice.
      role={name ? undefined : 'img'}
      aria-hidden={name ? true : undefined}
      aria-label={name ? undefined : 'item icon'}
      title={name}
    />
  );
}

export { hasItemIcon };
