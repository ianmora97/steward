/** A form field: the label above the control, then a hint or an error. The control goes in as the child. */
export function Field({
  label,
  hint,
  error,
  required = false,
  htmlFor,
  children
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="field">
      {htmlFor === undefined ? (
        <span className="field__label">
          {label}
          {required && (
            <span className="field__required" aria-hidden="true">
              *
            </span>
          )}
        </span>
      ) : (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
          {required && (
            <span className="field__required" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error !== undefined ? <p className="field__error">{error}</p> : hint !== undefined && <p className="field__hint">{hint}</p>}
    </div>
  );
}
