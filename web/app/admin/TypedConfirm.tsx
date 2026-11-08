// The typed-confirm field every destructive officer form carries (DECISIONS §493): the phrase is shown, the officer types
// it, and the form's server action compares it (lib/adminTyped.ts typedConfirmOk). `required` + `pattern` make the
// browser refuse a wrong phrase without any script; that is a courtesy, the server check is the gate.
import { phrasePattern } from '@/lib/adminTyped';

export default function TypedConfirm({ phrase, label = 'Type', className = '' }: { phrase: string; label?: string; className?: string }) {
  return (
    <label className={`inline-flex flex-wrap items-center gap-2 text-xs text-dim ${className}`}>
      <span>{label} <code className="rounded bg-red/10 px-1 py-0.5 text-red">{phrase}</code> to confirm</span>
      <input
        name="confirm"
        required
        pattern={phrasePattern(phrase)}
        title={`Type ${phrase} exactly`}
        autoComplete="off"
        spellCheck={false}
        placeholder="type it here"
        className="w-48 max-w-full bg-bg border border-red/50 rounded px-2 py-1 text-xs text-text font-mono focus:border-red"
      />
    </label>
  );
}
