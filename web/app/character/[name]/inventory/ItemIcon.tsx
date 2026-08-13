'use client';

// EQ item icon for the inventory grid.
//
// ⚠ This used to hotlink PQDI (`https://www.pqdi.cc/Icons/item_<icon>.png`) and
// hide the <img> via onError. That degradation was deliberate — "never a broken
// image square" — but it is also SILENT, and silent is how it shipped broken:
// every icon on the inventory page rendered as nothing at all (Hitya,
// 2026-08-13). Names showed, art did not, and there was no console error and no
// broken-image placeholder to hint at why.
//
// Meanwhile we already ship the art ourselves: `web/public/icons/items.png` is
// a single sprite atlas built from the client's own `dragitem*` sheets, and
// `web/components/ItemIcon.tsx` renders one cell out of it as a styled <span>.
// That component was already live on the loot surfaces; the inventory page was
// simply never moved onto it and kept its own copy. Every item in a real
// equipped set measured inside the atlas range (500..1723), so the atlas covers
// the case that was broken.
//
// So: atlas FIRST — local, one cached request for the whole page, no
// third-party dependency, and nothing leaks which items a member owns to
// another site. PQDI stays only as a fallback for icons the atlas does not
// cover (> ICON_LAST), where showing something beats showing nothing. If PQDI
// is also failing, that path degrades exactly as before.
//
// API is unchanged (default export, `alt`) so InventoryView and ItemHover did
// not have to move.

import { useState } from 'react';
import { ItemIcon as AtlasIcon, hasItemIcon } from '@/components/ItemIcon';

const ICON_BASE = (process.env.NEXT_PUBLIC_EQ_ICON_BASE || 'https://www.pqdi.cc/Icons').replace(/\/+$/, '');

export function iconUrl(icon: number | null | undefined): string | null {
  if (icon == null || icon <= 0) return null;
  return `${ICON_BASE}/item_${icon}.png`;
}

export default function ItemIcon({ icon, alt, size = 40, className }: {
  icon: number | null | undefined;
  alt: string;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  // Covered by the shipped atlas — the overwhelmingly common case.
  if (hasItemIcon(icon)) {
    return <AtlasIcon icon={icon} size={size} name={alt} className={className} />;
  }

  // Outside the atlas: fall back to the remote sheet rather than render nothing.
  const url = iconUrl(icon);
  if (!url || broken) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBroken(true)}
      className={className}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
