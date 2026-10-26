import { useState } from 'react';
import { DateTimePicker, type PickerPreset } from '../../components/DateTimePicker';
import { formatTtl } from './redis-meta';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const PRESETS: PickerPreset[] = [
  { label: '1 hour', value: () => new Date(Date.now() + HOUR) },
  { label: '1 day', value: () => new Date(Date.now() + DAY) },
  { label: '1 week', value: () => new Date(Date.now() + 7 * DAY) },
  { label: '30 days', value: () => new Date(Date.now() + 30 * DAY) }
];

/** When a key should expire, picked on a calendar. Empty means it never does. */
export function ExpiryField({
  value,
  onChange
}: {
  value: Date | null;
  onChange: (next: Date | null) => void;
}): React.JSX.Element {
  // The hint counts from when the field appeared: close enough to read "in about a day", and it keeps rendering pure.
  const [opened] = useState(() => Date.now());
  const remaining = value === null ? null : value.getTime() - opened;
  return (
    <>
      <DateTimePicker value={value} onChange={onChange} min={new Date(opened)} presets={PRESETS} placeholder="No expiry" label="Expires on" />
      <span className="card__hint">
        {remaining === null ? 'The key never expires.' : remaining <= 0 ? 'That moment has passed.' : `Expires in about ${formatTtl(remaining)}.`}
      </span>
    </>
  );
}

/** Whole seconds from now until `date`, at least 1: what EXPIRE takes. */
export function secondsUntil(date: Date): number {
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));
}
