'use client';

// Comments thread on /test-server. Flat list, newest first.
// Authors can delete their own; officers can delete any. No editing in v1.

import { useState, useTransition } from 'react';
import { postComment, deleteComment } from './actions';

export type CommentRow = {
  id:         string;
  user_id:    string;
  name:       string;
  body:       string;
  created_at: string;
  isMine:     boolean;
};

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)  return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Comments({ rows, canModerate }: { rows: CommentRow[]; canModerate: boolean }) {
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  // Optimistic delete — drop locally + reconcile with server.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  function submit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setErr(null);
    startTransition(async () => {
      const res = await postComment(trimmed);
      if (!res.ok) setErr(res.error ?? 'failed');
      else setBody('');
    });
  }

  function onDelete(id: string) {
    setHidden(h => { const n = new Set(h); n.add(id); return n; });
    startTransition(async () => {
      const res = await deleteComment(id);
      if (!res.ok) {
        // Roll back optimistic drop on failure.
        setHidden(h => { const n = new Set(h); n.delete(id); return n; });
        setErr(res.error ?? 'failed');
      }
    });
  }

  const visible = rows.filter(r => !hidden.has(r.id));

  return (
    <div className="space-y-3">
      <div className="bg-bg/30 border border-border rounded-lg p-3">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Share your thoughts on this proposal — concerns, alternatives, things you'd want different…"
          className="w-full min-h-[4.5rem] bg-bg border border-border rounded px-2 py-1.5 text-sm"
          maxLength={4000}
          disabled={pending}
        />
        <div className="flex items-center justify-between gap-2 mt-2">
          <span className="text-[10px] text-dim">{body.length}/4000</span>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !body.trim()}
            className="px-3 py-1 rounded border border-blue bg-[#1f6feb] text-white text-xs hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? 'Posting…' : 'Post comment'}
          </button>
        </div>
        {err && <div className="text-red text-[10px] mt-1">⚠ {err}</div>}
      </div>

      {visible.length === 0 ? (
        <div className="text-sm text-dim italic px-1">
          No comments yet. Be the first to weigh in.
        </div>
      ) : (
        <ul className="space-y-2.5">
          {visible.map(c => {
            const canDelete = c.isMine || canModerate;
            return (
              <li key={c.id} className="bg-panel border border-border rounded-lg p-3">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-text font-medium">{c.name}</span>
                  <span className="text-dim">{ago(c.created_at)}</span>
                </div>
                <div className="text-sm text-text mt-1 whitespace-pre-wrap break-words">{c.body}</div>
                {canDelete && (
                  <div className="mt-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => onDelete(c.id)}
                      disabled={pending}
                      className="text-[10px] text-dim hover:text-red"
                      title={c.isMine ? 'Delete your comment' : 'Officer delete'}
                    >
                      delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
