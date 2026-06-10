// utils/mimicReleases.js — resolve DIRECT installer download links for the
// latest stable + beta Mimic releases.
//
// The /parsehelp buttons used to point at wolfpack.quest/mimic (a landing
// page); the owner wants one-tap downloads like the dashboard header's
// "Download Mimic / Beta" pair. Asset filenames are versioned
// (Wolf-Pack-Mimic-Setup-<ver>.exe) so the links must be resolved live from
// the GitHub releases API. Detection is channel-agnostic: any release whose
// assets include the Setup exe is a Mimic release; `prerelease` splits
// stable vs beta. Cached 5 min — Discord interactions shouldn't block on
// GitHub more than once in a while, and 60 req/h anonymous is plenty.
'use strict';

const RELEASES_URL = 'https://api.github.com/repos/davehess/QuarmBossTracker/releases?per_page=20';
const FALLBACK_URL = 'https://wolfpack.quest/mimic';
const TTL_MS = 5 * 60 * 1000;

let _cache = { at: 0, stable: null, beta: null };

const _SETUP_RX = /^wolf-pack-mimic-setup-.*\.exe$/i;

async function getMimicDownloadUrls() {
  if ((Date.now() - _cache.at) < TTL_MS) return _cache;
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'quarm-raid-timer-bot' },
    });
    if (res.ok) {
      const releases = await res.json();
      let stable = null, beta = null;
      for (const r of Array.isArray(releases) ? releases : []) {
        const setup = (r.assets || []).find(a => a && _SETUP_RX.test(a.name || ''));
        if (!setup || !setup.browser_download_url) continue;
        if (r.prerelease) { if (!beta) beta = setup.browser_download_url; }
        else              { if (!stable) stable = setup.browser_download_url; }
        if (stable && beta) break;
      }
      _cache = { at: Date.now(), stable, beta };
      return _cache;
    }
  } catch { /* network hiccup — fall through to stale/fallback */ }
  // Keep serving the previous resolution (if any) on failure; refresh sooner.
  _cache.at = Date.now() - TTL_MS + 30_000;
  return _cache;
}

module.exports = { getMimicDownloadUrls, FALLBACK_URL };
