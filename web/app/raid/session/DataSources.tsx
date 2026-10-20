// "How do you have this data?" — a collapsed note under the session review (members' page and public share), so a
// reader from another guild can see that every line came from what a raid member's own game already shows them
// (the guild lead, 2026-10-15: "talks about the zeal pipe's exposure and miMIC"). Plain prose, no data reads.
export default function DataSources() {
  return (
    <details className="rounded-md border border-border bg-panel p-3 text-sm text-dim">
      <summary className="cursor-pointer select-none font-medium text-text">How do you have this data?</summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>
          Everything here is what the raid&apos;s own game clients already show the people in it. Nothing comes from the
          server, from packet capture, or from anyone who was not in the raid.
        </p>
        <p>
          <b className="text-text">Positions and attendance — the Zeal pipe.</b> Zeal, the client add-on most Project Quarm
          players run, has a &ldquo;named pipe&rdquo;: it hands the game&apos;s own raid window to other programs on the same
          computer — each raid member&apos;s name, class, level, health and location in that player&apos;s zone. Any raid
          member&apos;s client already holds exactly this. A raider only sees positions for people in their own zone, so
          the map only knows where someone was when at least one uploader shared their zone.
        </p>
        <p>
          <b className="text-text">miMIC.</b> Wolf Pack&apos;s desktop companion reads that pipe and the player&apos;s own
          game log on their own machine. Raiders who run it send a raid snapshot about every three seconds; the replay keeps
          one point per raider per three seconds. From the log it sends combat (the fights and damage in Parses), loot
          messages and /random rolls. Tells, guild and officer chat, group and custom channels are filtered out on the
          player&apos;s computer and never sent. Raiders who do not run miMIC still appear, because other raiders&apos;
          clients see them.
        </p>
        <p>
          <b className="text-text">What is left out.</b> Characters whose owners opted out of stats or inventory are shown
          only as their class and a number (&ldquo;Cleric 2&rdquo;), swapped in before this page is built. Anyone who won an
          item in this window is shown by name, since a closed auction&apos;s winner is public in OpenDKP. A shared link shows only this session&apos;s window, expires, and can be withdrawn by a
          Wolf Pack officer at any time.
        </p>
        <p>
          The full list of what is collected and kept is on the <a href="/privacy" className="underline hover:text-text">privacy page</a>.
        </p>
      </div>
    </details>
  );
}
