import { DateTimePicker } from '../../components/DateTimePicker';

export type RangePreset = '15m' | '1h' | '6h' | '24h' | '7d' | 'custom';

const PRESET_MS: Record<Exclude<RangePreset, 'custom'>, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000
};

const PRESET_LABEL: Record<RangePreset, string> = {
  '15m': '15 m',
  '1h': '1 h',
  '6h': '6 h',
  '24h': '24 h',
  '7d': '7 d',
  custom: 'Custom'
};

export interface RangeChoice {
  preset: RangePreset;
  from: Date | null;
  to: Date | null;
}

export const DEFAULT_RANGE: RangeChoice = { preset: '1h', from: null, to: null };

/** The range as milliseconds, with presets measured back from this moment. Null while a custom range is incomplete. */
export function resolveRange(choice: RangeChoice, presets: readonly RangePreset[], now = Date.now()): { fromMs: number; toMs: number } | null {
  if (choice.preset !== 'custom') {
    if (!presets.includes(choice.preset)) return null;
    return { fromMs: now - PRESET_MS[choice.preset], toMs: now };
  }
  if (choice.from === null || choice.to === null) return null;
  return { fromMs: choice.from.getTime(), toMs: choice.to.getTime() };
}

/** Preset buttons and, for a custom range, the two pickers. */
export function TimeRange({
  value,
  onChange,
  presets
}: {
  value: RangeChoice;
  onChange: (next: RangeChoice) => void;
  presets: readonly RangePreset[];
}): React.JSX.Element {
  return (
    <div className="mnrange">
      <div className="segmented" role="group" aria-label="Time range">
        {[...presets, 'custom' as const].map((preset) => (
          <button
            key={preset}
            type="button"
            className={`segmented__option${value.preset === preset ? ' segmented__option--active' : ''}`}
            onClick={() => onChange({ ...value, preset })}
          >
            {PRESET_LABEL[preset]}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <>
          <DateTimePicker label="From" value={value.from} onChange={(from) => onChange({ ...value, from })} placeholder="From" />
          <DateTimePicker label="To" value={value.to} onChange={(to) => onChange({ ...value, to })} placeholder="To" min={value.from ?? undefined} />
        </>
      )}
    </div>
  );
}
