import type { WorkflowInputSpec } from '@shared/schemas/deployments';

/**
 * What a field shows when the user has not touched it: the workflow's own default,
 * off for a checkbox, the first option for a choice (as GitHub's own form does).
 */
export function effectiveValue(spec: WorkflowInputSpec, edited: Record<string, string>): string {
  const untouched = spec.default ?? (spec.type === 'boolean' ? 'false' : spec.type === 'choice' ? (spec.options[0] ?? '') : '');
  return edited[spec.name] ?? untouched;
}

/** Every value that will be sent, edits and defaults merged. Empty optional text is left out. */
export function collectInputs(
  specs: readonly WorkflowInputSpec[],
  edited: Record<string, string>
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const spec of specs) {
    const value = effectiveValue(spec, edited);
    if (value !== '' || spec.required) values[spec.name] = value;
  }
  return values;
}

/** A required input with nothing in it blocks the deploy before main has to say so. */
export function missingRequired(specs: readonly WorkflowInputSpec[], edited: Record<string, string>): string | null {
  const missing = specs.find((spec) => spec.required && effectiveValue(spec, edited).trim() === '');
  return missing?.name ?? null;
}

/** One field per input the workflow declares, typed like GitHub's own "Run workflow" form. */
export function InputsForm({
  specs,
  edited,
  onChange
}: {
  specs: readonly WorkflowInputSpec[];
  edited: Record<string, string>;
  onChange: (name: string, value: string) => void;
}): React.JSX.Element {
  return (
    <div className="dpinputs">
      {specs.map((spec) => {
        const value = effectiveValue(spec, edited);
        const label = (
          <span className="field__label">
            {spec.name}
            {spec.required && <span className="dprequired"> *</span>}
          </span>
        );
        const hint = spec.description === null ? null : <span className="card__hint">{spec.description}</span>;

        if (spec.type === 'boolean') {
          return (
            <label key={spec.name} className="dpcheck">
              <input
                type="checkbox"
                checked={value === 'true'}
                onChange={(event) => onChange(spec.name, event.target.checked ? 'true' : 'false')}
              />
              <span>
                <strong>{spec.name}</strong>
                {spec.description !== null && ` — ${spec.description}`}
              </span>
            </label>
          );
        }
        if (spec.type === 'choice') {
          return (
            <label key={spec.name} className="field">
              {label}
              <select className="field__input" value={value} onChange={(event) => onChange(spec.name, event.target.value)}>
                {spec.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {hint}
            </label>
          );
        }
        return (
          <label key={spec.name} className="field">
            {label}
            <input
              className="field__input"
              type="text"
              inputMode={spec.type === 'number' ? 'decimal' : undefined}
              value={value}
              maxLength={2000}
              onChange={(event) => onChange(spec.name, event.target.value)}
            />
            {hint}
          </label>
        );
      })}
    </div>
  );
}
