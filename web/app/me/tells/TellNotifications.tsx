'use client';

// Device-local browser notifications for incoming tells. Subscribes to
// Supabase Realtime INSERTs on `tells` filtered to the owner, and pops a
// Notification when the tab isn't focused. Independent of the Discord-DM
// channel (toggled per-character on /me) — a member can run either, both,
// or neither.
//
// All preferences here are localStorage (per browser/device) by design: you
// want notifications on your gaming rig, maybe not a shared/work laptop. The
// Notification permission itself is also per-origin per-device, so this is the
// natural home for it.
//
// RLS note: the browser client carries the auth session, and `tells` has an
// owner-only SELECT policy, so the Realtime stream only ever delivers rows
// that belong to the signed-in user. The explicit owner filter is belt-and-
// suspenders + reduces wire chatter.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

type TellRow = {
  direction: 'incoming' | 'outgoing';
  other_name: string;
  owner_character: string;
  text: string;
};

const LS_NOTIF = 'wp_tells_notif';   // '1' | '0'
const LS_SOUND = 'wp_tells_sound';   // '1' | '0'

function lsGet(key: string, dflt: boolean) {
  if (typeof window === 'undefined') return dflt;
  const v = window.localStorage.getItem(key);
  return v === null ? dflt : v === '1';
}
function lsSet(key: string, val: boolean) {
  try { window.localStorage.setItem(key, val ? '1' : '0'); } catch { /* private mode */ }
}

// Short two-tone ping via WebAudio — no asset to ship, no autoplay-policy
// issues since it only fires after a user gesture enabled it.
function playPing() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      osc.connect(gain); gain.connect(ctx.destination);
      const t = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.start(t); osc.stop(t + 0.2);
    });
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch { /* audio unavailable — non-fatal */ }
}

export default function TellNotifications({ discordId }: { discordId: string }) {
  const router = useRouter();
  const [notifOn, setNotifOn] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [perm, setPerm]       = useState<NotificationPermission | 'unsupported'>('default');
  const [live, setLive]       = useState(false);
  // Keep latest toggle values readable inside the realtime callback without
  // re-subscribing on every toggle change.
  const notifRef = useRef(false);
  const soundRef = useRef(false);

  useEffect(() => {
    setNotifOn(lsGet(LS_NOTIF, false));
    setSoundOn(lsGet(LS_SOUND, false));
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPerm(Notification.permission);
    } else {
      setPerm('unsupported');
    }
  }, []);

  useEffect(() => { notifRef.current = notifOn; }, [notifOn]);
  useEffect(() => { soundRef.current = soundOn; }, [soundOn]);

  // Realtime subscription — lives for the page's lifetime regardless of toggle
  // state, so flipping a toggle takes effect instantly without reconnecting.
  // The callback checks the refs at fire time.
  useEffect(() => {
    if (!discordId) return;
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`tells:${discordId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tells', filter: `owner_discord_id=eq.${discordId}` },
        (payload) => {
          const row = payload.new as TellRow;
          // Refresh the server-rendered stream so the new row appears.
          router.refresh();
          if (row.direction !== 'incoming') return;  // only notify on inbound
          if (!notifRef.current) return;
          // Don't notify if the user is already looking at this tab.
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
          fireNotification(row);
          if (soundRef.current) playPing();
        },
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => { sb.removeChannel(channel); };
  }, [discordId, router]);

  function fireNotification(row: TellRow) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      // `renotify` isn't in the TS DOM lib's NotificationOptions yet, so cast.
      const opts = { body: row.text, tag: 'wp-tell', renotify: true } as NotificationOptions;
      const n = new Notification(`📬 ${row.other_name} → ${row.owner_character}`, opts);
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* non-fatal */ }
  }

  async function enableNotifications() {
    if (!('Notification' in window)) return;
    let p = Notification.permission;
    if (p === 'default') p = await Notification.requestPermission();
    setPerm(p);
    if (p === 'granted') { setNotifOn(true); lsSet(LS_NOTIF, true); }
  }

  function toggleNotif() {
    if (!notifOn) { enableNotifications(); return; }
    setNotifOn(false); lsSet(LS_NOTIF, false);
  }
  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next); lsSet(LS_SOUND, next);
    if (next) playPing();   // immediate confirmation it's audible
  }

  function testNotification() {
    if (perm !== 'granted') { enableNotifications(); return; }
    fireNotification({ direction: 'incoming', other_name: 'Daevyn', owner_character: 'Hitya', text: 'test — this is what a tell looks like' });
    if (soundOn) playPing();
  }

  if (perm === 'unsupported') {
    return (
      <div className="text-xs text-dim">
        This browser doesn&apos;t support notifications. The Discord DM channel still works.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      <button
        type="button"
        onClick={toggleNotif}
        title="Browser notifications fire when an incoming tell lands and this tab isn't focused. Device-local — set per browser. Independent of the Discord DM toggle on /me."
        className={`px-2 py-1 rounded border font-mono cursor-help ${
          notifOn && perm === 'granted'
            ? 'bg-green/20 text-green border-green/40'
            : 'bg-bg text-dim border-border hover:text-text'
        }`}
      >
        🔔 Browser: {notifOn && perm === 'granted' ? 'ON' : 'off'}
      </button>
      <button
        type="button"
        onClick={toggleSound}
        title="Play a short ping with each browser notification."
        className={`px-2 py-1 rounded border font-mono cursor-help ${
          soundOn ? 'bg-green/20 text-green border-green/40' : 'bg-bg text-dim border-border hover:text-text'
        }`}
      >
        🔊 Sound: {soundOn ? 'ON' : 'off'}
      </button>
      <button
        type="button"
        onClick={testNotification}
        className="px-2 py-1 rounded border border-border bg-bg text-dim hover:text-text font-mono"
      >
        Test
      </button>
      {perm === 'denied' && (
        <span className="text-orange">Notifications blocked in browser settings — re-enable there first.</span>
      )}
      <span className={`text-[10px] ${live ? 'text-green/70' : 'text-dim/60'}`} title="Live Supabase Realtime connection status">
        {live ? '● live' : '○ connecting'}
      </span>
    </div>
  );
}
