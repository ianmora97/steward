/**
 * A placeholder shaped like what is loading, for the first load of a view. Pair it with
 * `useDelayedFlag` so a fast load never flashes it.
 */
export function Skeleton({
  variant,
  lines = 1,
  width
}: {
  variant: 'line' | 'block' | 'row' | 'card';
  /** How many stacked placeholders to draw. */
  lines?: number;
  width?: string;
}): React.JSX.Element {
  return (
    <div className="skeleton__stack" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className={`skeleton skeleton--${variant}`}
          // The last line of a paragraph is shorter, as text is.
          style={{ width: width ?? (variant === 'line' && lines > 1 && index === lines - 1 ? '60%' : undefined) }}
        />
      ))}
    </div>
  );
}
