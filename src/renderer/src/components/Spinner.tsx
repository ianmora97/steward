/** A small indeterminate spinner that takes the colour of the text around it. */
export function Spinner({ size = 14 }: { size?: number }): React.JSX.Element {
  return <span className="spinner" style={{ width: size, height: size }} role="presentation" />;
}
