#!/usr/bin/env python3
"""token-usage.py — total Claude Code token spend across every local session.

WHY THIS EXISTS
    There is no cross-session total in the product surface: the in-app cost
    command reports the CURRENT session, and the Console usage page bills
    API-key traffic, not subscription Claude Code usage. The authoritative
    per-session record is the transcript Claude Code already writes to disk —
    every assistant message carries the exact `usage` block the API returned.
    This script sums those.

WHAT IT READS
    ~/.claude/projects/<project>/<session-id>.jsonl            (main sessions)
    ~/.claude/projects/<project>/<session-id>/subagents/*.jsonl (subagent runs)

    Subagent spend is REAL spend and is counted, attributed to its parent
    session. Records whose model is "<synthetic>" are Claude Code's own
    bookkeeping entries, not API calls, and are skipped.

⚠ SCOPE — READ THIS BEFORE TRUSTING A TOTAL
    Transcripts are LOCAL. A desktop machine keeps its own; a cloud session
    runs in an ephemeral container that is reclaimed, taking its transcripts
    with it. So this totals the sessions on the machine you run it on, not
    your account. Run it on each machine and add the results, and treat any
    total as a FLOOR — reclaimed cloud containers are unrecoverable.

PRICING
    List prices per million tokens, as of 2026-08-09. Cache multipliers follow
    the documented model: reads ~0.1x the input rate, writes 1.25x at the
    5-minute TTL and 2x at the 1-hour TTL — and the transcript records those
    two TTLs separately, so they are priced separately rather than blended.
    These are list rates: a subscription plan does not bill this way, so read
    the dollar column as "what this would have cost on the API", which is the
    honest way to quote it.

USAGE
    python3 scripts/token-usage.py                # summary + per-session table
    python3 scripts/token-usage.py --by-model     # group by model instead
    python3 scripts/token-usage.py --json         # machine-readable
    python3 scripts/token-usage.py --since 2026-08-01
"""

import argparse
import collections
import datetime as dt
import json
import os
import pathlib
import sys

# $ per 1M tokens: (input, output). Keys are matched as prefixes so dated
# snapshots (claude-haiku-4-5-20251001) resolve to their family.
PRICING = {
    "claude-fable-5":   (10.0, 50.0),
    "claude-mythos-5":  (10.0, 50.0),
    "claude-opus-5":    (5.0,  25.0),
    "claude-opus-4-8":  (5.0,  25.0),
    "claude-opus-4-7":  (5.0,  25.0),
    "claude-opus-4-6":  (5.0,  25.0),
    "claude-sonnet-5":  (3.0,  15.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0,   5.0),
}
CACHE_READ_MULT = 0.10
CACHE_WRITE_5M_MULT = 1.25
CACHE_WRITE_1H_MULT = 2.00


def price_for(model):
    """Longest-prefix match, so dated snapshots resolve to their family."""
    for key in sorted(PRICING, key=len, reverse=True):
        if model.startswith(key):
            return PRICING[key]
    return None


class Bucket:
    __slots__ = ("inp", "out", "cache_read", "cache_5m", "cache_1h", "calls",
                 "first", "last", "unpriced")

    def __init__(self):
        self.inp = self.out = self.cache_read = self.cache_5m = self.cache_1h = 0
        self.calls = 0
        self.first = self.last = None
        self.unpriced = set()

    def add(self, usage, model, ts):
        self.calls += 1
        self.inp += usage.get("input_tokens", 0) or 0
        self.out += usage.get("output_tokens", 0) or 0
        self.cache_read += usage.get("cache_read_input_tokens", 0) or 0
        # Split the cache WRITE by TTL — the two bill at different multipliers.
        cc = usage.get("cache_creation") or {}
        m5 = cc.get("ephemeral_5m_input_tokens")
        h1 = cc.get("ephemeral_1h_input_tokens")
        if m5 is None and h1 is None:
            # Older transcripts carry only the flat total; assume the 5m TTL,
            # which is the cheaper multiplier — so the estimate stays a floor.
            self.cache_5m += usage.get("cache_creation_input_tokens", 0) or 0
        else:
            self.cache_5m += m5 or 0
            self.cache_1h += h1 or 0
        if price_for(model) is None:
            self.unpriced.add(model)
        if ts:
            self.first = ts if self.first is None else min(self.first, ts)
            self.last = ts if self.last is None else max(self.last, ts)

    @property
    def total_tokens(self):
        return self.inp + self.out + self.cache_read + self.cache_5m + self.cache_1h


def cost_of(bucket_by_model):
    """Cost in USD. Models with no published price contribute 0 and are flagged."""
    total = 0.0
    for model, b in bucket_by_model.items():
        pr = price_for(model)
        if pr is None:
            continue
        inp_rate, out_rate = pr
        total += (b.inp / 1e6) * inp_rate
        total += (b.out / 1e6) * out_rate
        total += (b.cache_read / 1e6) * inp_rate * CACHE_READ_MULT
        total += (b.cache_5m / 1e6) * inp_rate * CACHE_WRITE_5M_MULT
        total += (b.cache_1h / 1e6) * inp_rate * CACHE_WRITE_1H_MULT
    return total


def iter_transcripts(root):
    """Yield (session_id, project, path, is_subagent) for every transcript."""
    if not root.is_dir():
        return
    for project_dir in sorted(root.iterdir()):
        if not project_dir.is_dir():
            continue
        for path in sorted(project_dir.glob("*.jsonl")):
            yield path.stem, project_dir.name, path, False
        # Subagent runs live one level down, under the parent session's id.
        for sub in sorted(project_dir.glob("*/subagents/*.jsonl")):
            yield sub.parent.parent.name, project_dir.name, sub, True


def parse_ts(rec):
    raw = rec.get("timestamp")
    if not raw:
        return None
    try:
        return dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=os.path.expanduser("~/.claude/projects"),
                    help="transcript root (default: ~/.claude/projects)")
    ap.add_argument("--since", help="only count messages on/after this date (YYYY-MM-DD)")
    ap.add_argument("--by-model", action="store_true", help="group by model, not session")
    ap.add_argument("--counterfactual", action="store_true",
                    help="also price the same tokens with NO prompt caching")
    ap.add_argument("--json", action="store_true", dest="as_json", help="machine-readable output")
    args = ap.parse_args()

    since = None
    if args.since:
        since = dt.datetime.fromisoformat(args.since).replace(tzinfo=dt.timezone.utc)

    per_session = collections.defaultdict(lambda: collections.defaultdict(Bucket))
    per_model = collections.defaultdict(Bucket)
    projects = collections.defaultdict(set)
    files = skipped = 0

    for session_id, project, path, _is_sub in iter_transcripts(pathlib.Path(args.root)):
        files += 1
        try:
            fh = open(path, encoding="utf-8")
        except OSError:
            skipped += 1
            continue
        with fh:
            for line in fh:
                try:
                    rec = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                msg = rec.get("message") or {}
                usage = msg.get("usage")
                if not usage:
                    continue
                model = msg.get("model") or "unknown"
                if model == "<synthetic>":
                    continue           # bookkeeping entry, not an API call
                ts = parse_ts(rec)
                if since and ts and ts < since:
                    continue
                per_session[session_id][model].add(usage, model, ts)
                per_model[model].add(usage, model, ts)
                projects[session_id].add(project)

    if not per_session:
        print(f"No usage found under {args.root}.", file=sys.stderr)
        print("On a cloud session this is expected — containers are ephemeral.", file=sys.stderr)
        return 1

    grand = cost_of(per_model)
    tok = sum(b.total_tokens for b in per_model.values())
    calls = sum(b.calls for b in per_model.values())

    if args.as_json:
        out = {
            "root": args.root,
            "files_read": files,
            "sessions": len(per_session),
            "api_calls": calls,
            "total_tokens": tok,
            "list_cost_usd": round(grand, 2),
            "by_model": {
                m: {"calls": b.calls, "input": b.inp, "output": b.out,
                    "cache_read": b.cache_read, "cache_write_5m": b.cache_5m,
                    "cache_write_1h": b.cache_1h,
                    "list_cost_usd": round(cost_of({m: b}), 2)}
                for m, b in sorted(per_model.items())
            },
            "by_session": {
                s: {"projects": sorted(projects[s]),
                    "tokens": sum(b.total_tokens for b in bm.values()),
                    "list_cost_usd": round(cost_of(bm), 2)}
                for s, bm in per_session.items()
            },
        }
        print(json.dumps(out, indent=2))
        return 0

    def fmt(n):
        return f"{n:,}"

    print()
    print(f"  Claude Code token usage — {args.root}")
    print(f"  {files} transcript file(s), {len(per_session)} session(s), {fmt(calls)} API calls")
    if args.since:
        print(f"  filtered to messages on/after {args.since}")
    print()

    if args.by_model:
        rows = sorted(per_model.items(), key=lambda kv: -cost_of({kv[0]: kv[1]}))
        print(f"  {'MODEL':<28} {'CALLS':>7} {'INPUT':>12} {'OUTPUT':>11} "
              f"{'CACHE R':>15} {'CACHE W':>13} {'LIST $':>10}")
        print("  " + "-" * 100)
        for model, b in rows:
            print(f"  {model[:28]:<28} {b.calls:>7,} {b.inp:>12,} {b.out:>11,} "
                  f"{b.cache_read:>15,} {b.cache_5m + b.cache_1h:>13,} "
                  f"{cost_of({model: b}):>10,.2f}")
        # Totals line must match THIS table's column widths, not the other mode's.
        t_in = sum(b.inp for b in per_model.values())
        t_out = sum(b.out for b in per_model.values())
        t_cr = sum(b.cache_read for b in per_model.values())
        t_cw = sum(b.cache_5m + b.cache_1h for b in per_model.values())
        print("  " + "-" * 100)
        print(f"  {'TOTAL':<28} {calls:>7,} {t_in:>12,} {t_out:>11,} "
              f"{t_cr:>15,} {t_cw:>13,} {grand:>10,.2f}")
    else:
        rows = sorted(per_session.items(), key=lambda kv: -cost_of(kv[1]))
        print(f"  {'SESSION':<38} {'CALLS':>7} {'TOKENS':>16} {'LIST $':>10}  WHEN")
        print("  " + "-" * 100)
        for sid, bm in rows:
            b_calls = sum(b.calls for b in bm.values())
            b_tok = sum(b.total_tokens for b in bm.values())
            firsts = [b.first for b in bm.values() if b.first]
            when = min(firsts).strftime("%Y-%m-%d") if firsts else "—"
            print(f"  {sid[:38]:<38} {b_calls:>7,} {b_tok:>16,} "
                  f"{cost_of(bm):>10,.2f}  {when}")
        print("  " + "-" * 100)
        print(f"  {'TOTAL':<38} {calls:>7,} {tok:>16,} {grand:>10,.2f}")

    print()

    if args.counterfactual:
        # What the SAME tokens would cost with no prompt caching at all: every
        # cached token (read or written) billed as fresh input. This is the
        # number that shows caching discipline is load-bearing rather than
        # incidental — useful when the question is "is this spend controlled?"
        uncached = 0.0
        cache_tokens = 0
        for model, b in per_model.items():
            pr = price_for(model)
            if pr is None:
                continue
            inp_rate, out_rate = pr
            cached = b.cache_read + b.cache_5m + b.cache_1h
            cache_tokens += b.cache_read
            uncached += (b.inp / 1e6) * inp_rate
            uncached += (b.out / 1e6) * out_rate
            uncached += (cached / 1e6) * inp_rate
        print(f"  cache reads          {cache_tokens:>18,}  "
              f"({cache_tokens / tok * 100:.1f}% of all tokens)")
        print(f"  as measured (list)   ${grand:>17,.0f}")
        print(f"  same work, no cache  ${uncached:>17,.0f}   ({uncached / grand:.1f}x)")
        print(f"  avoided by caching   ${uncached - grand:>17,.0f}")
        print()

    unpriced = set()
    for b in per_model.values():
        unpriced |= b.unpriced
    if unpriced:
        print(f"  ⚠ no published price for: {', '.join(sorted(unpriced))} — "
              f"their tokens are counted but cost 0 here.")
    print("  Dollar figures are LIST API rates, not what a subscription bills.")
    print("  Local transcripts only — cloud-session containers are reclaimed, so")
    print("  treat this as a floor and run it on every machine you work from.")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
