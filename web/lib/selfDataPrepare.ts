// "Prepare my data", the browser half (the guild lead, 2026-11-01: the single streamed download showed no size and
// stopped partway, leaving a file that was not valid JSON). The page asks the manifest route what the file will
// contain, fetches each section from the part route, and only when every section is in hand builds the file and
// offers it. Nothing is saved until it is whole.
//
// No imports on purpose: a client component and the root vitest suite both load this file, and neither should pull
// the server's database code with it.

export type ManifestSection = { name: string; group: string };
export type Manifest = {
  exported_at: string;
  about: string;
  row_cap: number;
  character_row_cap: number;
  not_included: unknown[];
  sections: ManifestSection[];
};
export type PartOut = { group?: string; error?: string; [k: string]: unknown };

/** The file's pieces, in order: the same top-level shape the single streamed download had. join('') is the JSON text. */
export function assembleExport(manifest: Manifest, parts: Record<string, PartOut>): string[] {
  const out: string[] = [
    `{"exported_at":${JSON.stringify(manifest.exported_at)},`
      + `"about":${JSON.stringify(manifest.about)},`
      + `"row_cap":${manifest.row_cap},"character_row_cap":${manifest.character_row_cap},"tables":{`,
  ];
  manifest.sections.forEach((s, i) => {
    out.push(`${i ? ',' : ''}${JSON.stringify(s.name)}:${JSON.stringify(parts[s.name] ?? { group: s.group, error: 'This section was not fetched.' })}`);
  });
  out.push(`},"not_included":${JSON.stringify(manifest.not_included)}}`);
  return out;
}

export const exportFilename = (exportedAt: string): string => `raidmimic-data-${exportedAt.slice(0, 10)}.json`;

/** 21.4 MB, 850 KB, 12 B. Decimal units, one decimal place from MB up: the same figure a phone's file manager shows. */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
  return `${(n / 1_000_000).toFixed(1)} MB`;
}

export const PART_UNAVAILABLE = 'This section could not be fetched. Prepare again in a few minutes.';
export const PART_CONCURRENCY = 3;

export type Prepared = {
  pieces: string[];
  filename: string;
  sections: number;
  failed: string[];        // sections that came back with an error, or never came back
};

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

async function fetchPart(fetchFn: FetchLike, url: string): Promise<PartOut> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`part ${res.status}`);
  const body = await res.json();      // a body cut short throws here, which is what the retry is for
  if (!body || typeof body !== 'object') throw new Error('part body');
  return body as PartOut;
}

/**
 * Fetch the manifest, then every section (a few at a time), retrying a failed section once. Throws with a sentence
 * for the person when the manifest itself is refused (signed out, or prepared too recently). A section that still
 * fails is put in the file as an `error` and named in `failed`, so the rest of the file is intact.
 */
export async function prepareExport(
  fetchFn: FetchLike,
  manifestUrl: string,
  partUrl: (section: string) => string,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<Prepared> {
  const mres = await fetchFn(manifestUrl);
  if (!mres.ok) {
    let msg = 'Could not start preparing your data just now. Try again in a minute.';
    try { const b = await mres.json(); if (typeof b?.error === 'string') msg = b.error; } catch { /* keep the default */ }
    throw new Error(msg);
  }
  const manifest = (await mres.json()) as Manifest;
  const total = manifest.sections.length;
  const parts: Record<string, PartOut> = {};
  const failed: string[] = [];
  let next = 0;
  let done = 0;
  onProgress(0, total);
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      const s = manifest.sections[i];
      let part: PartOut | null = null;
      for (let attempt = 0; attempt < 2 && !part; attempt++) {
        try { part = await fetchPart(fetchFn, partUrl(s.name)); } catch { /* retried once */ }
      }
      if (!part) part = { group: s.group, error: PART_UNAVAILABLE };
      if (typeof part.error === 'string') failed.push(s.name);
      parts[s.name] = part;
      onProgress(++done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, total) }, worker));
  failed.sort((a, b) => manifest.sections.findIndex(x => x.name === a) - manifest.sections.findIndex(x => x.name === b));
  return { pieces: assembleExport(manifest, parts), filename: exportFilename(manifest.exported_at), sections: total, failed };
}
