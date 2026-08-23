// The connected workflow view on /ai — one task, start to finish, with the
// branch points drawn as branches rather than described in prose.
//
// Two structures on this page, each matching its content: the milestone spine
// is a LINE because chronology is linear, and this is a TREE because routing
// is not. Where a stage forks, the fork is visible — that is the part an agent
// has to reproduce, and a paragraph hides it.
//
// Server-rendered: nothing here reacts, so none of it needs to ship as JS.
import type { WorkflowStage } from '@/lib/aiMethodology';

export default function AiWorkflowTree({ stages }: { stages: WorkflowStage[] }) {
  return (
    <ol className="relative space-y-2.5">
      {/* The trunk. Sits behind the nodes, stops short of the last one so the
          tree visibly ends rather than trailing off. */}
      <div
        className="absolute left-[11px] top-3 bottom-8 w-px bg-border"
        aria-hidden
      />
      {stages.map((s, i) => (
        <li key={s.id} className="relative pl-9">
          <span
            aria-hidden
            className="absolute left-0 top-1.5 h-6 w-6 rounded-full border border-border bg-panel
                       flex items-center justify-center text-[11px] text-dim tabular-nums"
          >
            {i + 1}
          </span>

          <div className="rounded-lg border border-border bg-panel px-4 py-3">
            <h3 className="text-sm text-text">{s.step}</h3>
            <p className="mt-1.5 text-[13px] leading-6 text-dim">{s.detail}</p>

            {s.branches && (
              <ul className="mt-3 space-y-1.5">
                {s.branches.map(b => (
                  <li key={b.when} className="relative pl-5 text-[13px] leading-6">
                    {/* Elbow connector — the branch reads as a branch. */}
                    <span
                      aria-hidden
                      className="absolute left-0 top-0 h-3 w-3 border-l border-b border-border rounded-bl"
                    />
                    <span className="text-orange/85">{b.when}</span>
                    <span className="text-dim"> → </span>
                    <span className="text-text">{b.then}</span>
                  </li>
                ))}
              </ul>
            )}

            {s.commands && (
              <pre className="mt-3 overflow-x-auto rounded border border-border bg-bg px-3 py-2 text-[12px] leading-6 text-green/90">
{s.commands.join('\n')}
              </pre>
            )}

            {s.guards && (
              <p className="mt-3 text-[12px] leading-6 text-orange/70">
                <span className="uppercase tracking-wider text-[10px] text-orange/60 mr-2">guards against</span>
                {s.guards}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
