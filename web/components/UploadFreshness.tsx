// One line saying when a character's gear, inventory and spellbook last arrived. Server component, no client JS.
// Pass only the kinds the viewer may see: a kind left out is not drawn, so a page that hides a character's inventory
// or spells from the viewer must not pass them (the gear page does that check; the inventory and spells pages gate the
// whole page).
import { userTz } from '@/lib/timezone';
import { describeUpload, type UploadStamps } from '@/lib/uploadFreshness';

type Props = {
  gear?: UploadStamps | null;
  inventory?: UploadStamps | null;
  spells?: UploadStamps | null;
};

export default async function UploadFreshness({ gear, inventory, spells }: Props) {
  const tz = await userTz();
  const parts: { key: string; name: string; stamps: UploadStamps | null | undefined }[] = [];
  if (gear !== undefined) parts.push({ key: 'gear', name: 'Gear', stamps: gear });
  if (inventory !== undefined) parts.push({ key: 'inventory', name: 'Inventory', stamps: inventory });
  if (spells !== undefined) parts.push({ key: 'spells', name: 'Spells', stamps: spells });
  if (parts.length === 0) return null;
  return (
    <p className="mt-2 text-xs text-dim" data-testid="upload-freshness">
      Last upload:{' '}
      {parts.map((p, i) => {
        const d = describeUpload(p.stamps, tz);
        return (
          <span key={p.key}>
            {i > 0 && <span aria-hidden> · </span>}
            <span title={d.title} className="cursor-help">{p.name} <span className="text-text">{d.label}</span></span>
          </span>
        );
      })}
    </p>
  );
}
