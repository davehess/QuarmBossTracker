// /ai.json — the machine-readable mirror of /ai.
//
// Same data object the page renders, so the two can never disagree. Served
// with a permissive CORS header because the point is that an agent belonging
// to someone else can fetch it.
import { NextResponse } from 'next/server';
import {
  PRINCIPLES, MILESTONES, WORKFLOW, GATES, METHOD_NOTES, MEASURED,
  REPO_URL, commitUrl, fileUrl,
} from '@/lib/aiMethodology';

export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(
    {
      $schema: 'https://wolfpack.quest/ai.json',
      title: 'Wolf Pack — AI development methodology',
      description:
        'The working method behind a four-component guild platform built and maintained by AI coding sessions. Every rule is paired with the incident that produced it.',
      html: 'https://wolfpack.quest/ai',
      markdown: 'https://wolfpack.quest/ai.txt',
      repository: REPO_URL,
      authoritativeSources: [
        { path: 'CLAUDE.md', url: fileUrl('CLAUDE.md'), role: 'architecture, release routing, scope boundaries' },
        { path: 'docs/GEMINI-SPARK-HELPER.md', url: fileUrl('docs/GEMINI-SPARK-HELPER.md'), role: 'working guide for an agent with repo access' },
        { path: 'docs/AI-CONTRIBUTOR-BRIEF.md', url: fileUrl('docs/AI-CONTRIBUTOR-BRIEF.md'), role: 'brief for a chat assistant with no repo access' },
      ],
      note:
        'This page is an index into the repository, not a replacement for it. Where they differ, the files in the repository are authoritative.',
      caveat:
        'This method suits a repo with two very large single files, few readers, and consequences that land on a schedule. Adopt the shape; derive your own rules from your own incidents.',
      measured: MEASURED,
      principles: PRINCIPLES.map(p => ({
        ...p,
        sourceUrl: fileUrl(p.sourceDoc),
      })),
      milestones: MILESTONES.map(m => ({
        ...m,
        commits: m.commits.map(c => ({ ...c, url: commitUrl(c.sha) })),
      })),
      workflow: WORKFLOW,
      verificationGate: GATES,
      methodNotes: METHOD_NOTES,
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
      },
    },
  );
}
