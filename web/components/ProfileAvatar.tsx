'use client';
// The Discord picture on the signed-in home (2026-11-10, the guild lead: "looks like the discord picture is missing").
// The address comes from the sign-in profile, which Discord only refreshes at the next sign-in, and the CDN or a browser
// can refuse it. A picture that fails to load falls back to the name's first letter, never a broken-image icon.
import { useState } from 'react';

export default function ProfileAvatar({ src, name }: { src: string | null; name: string | null }) {
  const [failed, setFailed] = useState(false);
  const initial = (name ?? '').trim().charAt(0).toUpperCase() || '?';
  if (src && !failed) {
    return (
      <img src={src} alt="" width={48} height={48} onError={() => setFailed(true)}
        className="h-12 w-12 rounded-full border border-border object-cover" />
    );
  }
  return (
    <span aria-hidden data-avatar-fallback
      className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-panel text-lg text-gold">
      {initial}
    </span>
  );
}
