// Theoretical TPS planner — placeholder for the next iteration.
// Once the proc-hate formulas are wired up, this page becomes a build planner:
// pick MH/OH/Range/Ammo from the eqemu_items list, get a hate/min estimate
// from the formulas you posted in the screenshot (PPM × proc_hate + swing rate ×
// (DMG + bonus)).
export default function PlannerPage() {
  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-3">🧮 Theoretical TPS Planner</h2>
        <p className="text-sm text-dim leading-6">
          Pick a primary, secondary, range, and ammo from the item database; the
          planner will project hate/min from procs + swings using the Quarm formulas:
        </p>
        <ul className="text-xs text-dim mt-3 space-y-1 list-disc list-inside">
          <li>Main hand hate = weapon damage + damage bonus per swing (lv28+ melee)</li>
          <li>Offhand hate = weapon damage only, no damage bonus</li>
          <li>Procs fire at ~2 PPM at 255 DEX, independent of delay and haste</li>
          <li>Misses do not reduce hate</li>
          <li>Riposte / taunt / damage shields / spells / heals not modeled</li>
        </ul>
        <p className="text-sm text-orange mt-4">
          UI lands once the proc-hate catalog stabilises. Tracking via the agent's
          live PROC_HATE map and the new eqemu_spells join.
        </p>
      </section>
    </div>
  );
}
