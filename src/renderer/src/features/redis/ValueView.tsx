import { useMemo, useState } from 'react';
import { decodeBase64, detectFormat, formatValue, type ValueFormat } from '@shared/redis/value-format';

const FORMATS: { value: ValueFormat; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'json', label: 'JSON' },
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' }
];

/** One value, shown as text, JSON, hex or base64. Binary content opens as hex, because text would be garbage. */
export function ValueView({ encoded, notice }: { encoded: string; notice?: string }): React.JSX.Element {
  const bytes = useMemo(() => decodeBase64(encoded), [encoded]);
  const detected = useMemo(() => detectFormat(bytes), [bytes]);
  const [format, setFormat] = useState<ValueFormat | null>(null);
  const active: ValueFormat = format ?? (detected === 'binary' ? 'hex' : detected);
  const rendered = useMemo(() => formatValue(bytes, active), [bytes, active]);

  return (
    <div className="rdvalue">
      <div className="rdvalue__bar">
        <div className="segmented" role="group" aria-label="Value format">
          {FORMATS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`segmented__option${active === option.value ? ' segmented__option--active' : ''}`}
              onClick={() => setFormat(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="card__hint">
          {bytes.length} byte{bytes.length === 1 ? '' : 's'}
          {detected === 'binary' ? ' · binary' : ''}
        </span>
        {notice !== undefined && <span className="card__hint">{notice}</span>}
      </div>
      <pre className="rdvalue__body dpmono">{rendered}</pre>
    </div>
  );
}
