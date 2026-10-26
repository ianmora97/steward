import type { MongoExplainSummary } from '@shared/schemas/mongodb';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';

/** What an explain says at a glance: an index scan is good news, a full collection scan is worth a second look. */
export function ExplainPanel({ summary, onClose }: { summary: MongoExplainSummary; onClose: () => void }): React.JSX.Element {
  return (
    <section className="mgexplain" aria-label="Query plan">
      <header className="mgexplain__head">
        <strong>Query plan</strong>
        {summary.stage === 'COLLSCAN' ? (
          <Badge tone="warning" icon="alert" title="Every document of the collection was examined">
            COLLSCAN
          </Badge>
        ) : (
          <Badge tone={summary.usesIndex ? 'success' : 'neutral'} icon={summary.usesIndex ? 'checkCircle' : 'minusCircle'}>
            {summary.stage}
            {summary.indexName === null ? '' : ` · ${summary.indexName}`}
          </Badge>
        )}
        <span className="dpitem__spacer" />
        <Button size="sm" onClick={onClose}>
          Close
        </Button>
      </header>
      <dl className="dpsummary">
        <dt>Returned</dt>
        <dd>{summary.nReturned ?? '—'}</dd>
        <dt>Documents examined</dt>
        <dd>{summary.docsExamined ?? '—'}</dd>
        <dt>Index keys examined</dt>
        <dd>{summary.keysExamined ?? '—'}</dd>
        <dt>Execution time</dt>
        <dd>{summary.executionTimeMillis === null ? '—' : `${summary.executionTimeMillis} ms`}</dd>
      </dl>
      <details>
        <summary>Full explain output</summary>
        <pre className="dplog dpmono">{JSON.stringify(JSON.parse(summary.raw) as unknown, null, 2)}</pre>
      </details>
    </section>
  );
}
