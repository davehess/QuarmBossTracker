// /ai.txt — the whole method as one plain-markdown document.
//
// For an agent that can fetch a URL and nothing else: no JavaScript, no repo,
// no parsing of page markup. Generated from the same data as /ai so it cannot
// drift, and ordered so the first screen already tells a reader what this is
// and where the authoritative files live.
import {
  PRINCIPLES, MILESTONES, WORKFLOW, GATES, METHOD_NOTES, MEASURED,
  REPO_URL, commitUrl, fileUrl, TIMELINE,
} from '@/lib/aiMethodology';

export const dynamic = 'force-static';

function render(): string {
  const L: string[] = [];
  const p = (s = '') => L.push(s);

  p('# Wolf Pack — how this platform is built and maintained with AI');
  p();
  p('A four-component guild platform (Discord bot, website, log-parsing agent on');
  p('each user PC, desktop overlay app) built and maintained almost entirely by AI');
  p('coding sessions that cannot see each other’s conversations. What holds it');
  p('together is written rules — each adopted the day a specific failure made it');
  p('necessary — plus a verification gate that runs before anything ships.');
  p();
  p(`- Human view: https://wolfpack.quest/ai`);
  p(`- Structured: https://wolfpack.quest/ai.json`);
  p(`- Repository: ${REPO_URL}`);
  p();
  p('Authoritative sources (this document is an index into them, not a replacement):');
  p(`- CLAUDE.md — architecture, release routing, scope boundaries. ${fileUrl('CLAUDE.md')}`);
  p(`- docs/GEMINI-SPARK-HELPER.md — working guide for an agent with repo access. ${fileUrl('docs/GEMINI-SPARK-HELPER.md')}`);
  p(`- docs/AI-CONTRIBUTOR-BRIEF.md — brief for a chat assistant with no repo access. ${fileUrl('docs/AI-CONTRIBUTOR-BRIEF.md')}`);
  p();
  p(`Measured ${MEASURED.asOf}: ${MEASURED.commits} commits, ${MEASURED.tests} tests across`);
  p(`${MEASURED.testFiles} files, ${MEASURED.docs} documents, ${MEASURED.decisionRecords} decision`);
  p(`records, ${MEASURED.betaSyncs} automatic branch syncs. First commit ${MEASURED.firstCommit}.`);
  p('Counted, not estimated.');
  p();
  p('CAVEAT: this method suits a repo with two very large single files, few');
  p('readers, and consequences that land on a schedule. Adopt the shape; derive');
  p('your own rules from your own incidents.');
  p();

  p('## 1. Standing rules');
  p();
  p('Each rule states what it requires and the incident that produced it.');
  p();
  for (const r of PRINCIPLES) {
    p(`### ${r.title}`);
    p(`- Adopted: ${r.adopted}`);
    p(`- Rule: ${r.rule}`);
    p(`- Because: ${r.because}`);
    p(`- Lives in: ${r.sourceDoc} (${fileUrl(r.sourceDoc)})`);
    p();
  }

  p('## 2. The task workflow');
  p();
  for (const [i, s] of WORKFLOW.entries()) {
    p(`### ${i + 1}. ${s.step}`);
    p(s.detail);
    if (s.branches) {
      p();
      for (const b of s.branches) p(`- IF ${b.when} → ${b.then}`);
    }
    if (s.commands) {
      p();
      p('```');
      for (const c of s.commands) p(c);
      p('```');
    }
    if (s.guards) { p(); p(`Guards against: ${s.guards}`); }
    p();
  }

  p('## 3. The verification gate');
  p();
  for (const g of GATES) {
    p(`- \`${g.command}\` — ${g.inCi ? 'blocks CI' : 'NOT in CI, run it yourself'}. ${g.protects}`);
  }
  p();

  p('## 4. How the work is written');
  p();
  for (const n of METHOD_NOTES) {
    p(`### ${n.title}`);
    p(n.body);
    p();
  }

  p('## 5. Adoption timeline');
  p();
  p('Oldest first. Every entry is a real commit; this repo ships by direct push,');
  p('so commits rather than pull requests are the durable unit of history.');
  p();
  for (const m of TIMELINE) {
    p(`### ${m.date} — ${m.title}`);
    p(`What forced it: ${m.trigger}`);
    p(`What changed: ${m.change}`);
    if (m.outcome) p(`Measured after: ${m.outcome}`);
    const born = PRINCIPLES.filter(x => x.milestone === m.id).map(x => x.title);
    if (born.length) p(`Rules introduced: ${born.join('; ')}`);
    for (const c of m.commits) p(`Commit: ${c.sha} ${c.subject} — ${commitUrl(c.sha)}`);
    p();
  }

  return L.join('\n');
}

export function GET() {
  return new Response(render(), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
