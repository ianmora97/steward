function CardRoot({
  muted = false,
  className = '',
  style,
  children
}: {
  muted?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className={`card${muted ? ' card--muted' : ''}${className === '' ? '' : ` ${className}`}`} style={style}>
      {children}
    </section>
  );
}

function CardHeader({ title, children }: { title: React.ReactNode; children?: React.ReactNode }): React.JSX.Element {
  return (
    <header className="card__header">
      <h3 className="card__title">{title}</h3>
      {children}
    </header>
  );
}

function CardBody({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="card__body">{children}</div>;
}

function CardFooter({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <footer className="card__footer">{children}</footer>;
}

/** The surface every block of content sits on: `Card`, with `Card.Header`, `Card.Body` and `Card.Footer`. */
export const Card = Object.assign(CardRoot, { Header: CardHeader, Body: CardBody, Footer: CardFooter });
