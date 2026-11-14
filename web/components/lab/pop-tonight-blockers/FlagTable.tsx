// The full raider-by-flag list (a legitimate full list): one row per raider, a mark per flag.
export type FlagTableData = { flags: { key: string; short: string }[]; rows: { name: string; cls: string; has: boolean[] }[] };

export default function FlagTable({ data }: { data: FlagTableData }) {
  return (
    <div className="overflow-x-auto px-3 pb-3">
      <table className="w-full min-w-[420px] text-xs">
        <thead>
          <tr className="text-left text-dim">
            <th className="py-1 pr-2 font-normal">Raider</th>
            {data.flags.map((f) => <th key={f.key} className="px-1 py-1 text-center font-normal">{f.short}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.name} className="border-t border-border/60">
              <td className="py-0.5 pr-2 text-text">{r.name} <span className="text-dim">{r.cls}</span></td>
              {r.has.map((h, i) => (
                <td key={i} className={`px-1 py-0.5 text-center ${h ? 'text-green' : 'text-red'}`}>
                  <span aria-label={h ? 'has it' : 'missing'}>{h ? '✓' : '✗'}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
