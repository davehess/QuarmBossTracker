'use client';

// EQ item icon. `icon` is a numeric index into the gequip sprite set; we render
// <base>/item_<icon>.png. The base is configurable via NEXT_PUBLIC_EQ_ICON_BASE
// and defaults to PQDI's icon path (the Quarm DB the guild already uses).
//
// Robustness: if the host is unreachable or the path is wrong, onError hides
// the <img> and the caller's text label shows through — never a broken-image
// square. So a wrong base just degrades to the pre-icon look; flipping the env
// var to a working host lights every icon up with no code change.

import { useState } from 'react';

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
