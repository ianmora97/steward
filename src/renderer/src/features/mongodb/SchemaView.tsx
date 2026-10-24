import { useState } from 'react';
import type { MongoConnection, MongoSchemaResult } from '@shared/schemas/mongodb';
import type { StewardError } from '@shared/types/result';

const SAMPLE_SIZES = [100, 1000, 5000] as const;

/** A quick look at what the documents of a collection have in common: fields, types and example values. */
export function SchemaView({
  connection,
  db,
  collection,
  onError
}: {
  connection: MongoConnection;
  db: string;
  collection: string;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const [sampleSize, setSampleSize] = useState<number>(1000);
  const [result, setResult] = useState<MongoSchemaResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function analyze(): Promise<void> {
    setBusy(true);
    const response = await window.steward.mongo.analyzeSchema({ connectionId: connection.id, db, collection, sampleSize });
    setBusy(false);
    if (response.success) setResult(response.data);
    else onError(response.error);
  }

  return (
    <section className="mgschema">
      <div className="mgtoolbar">
        <label className="field mgschema__size">
          <span className="field__label">Sample</span>
          <select className="field__input" value={sampleSize} onChange={(event) => setSampleSize(Number(event.target.value))}>
            {SAMPLE_SIZES.map((value) => (
              <option key={value} value={value}>
                {value} documents
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button button--primary" disabled={busy} onClick={() => void analyze()}>
          {busy ? 'Analyzing…' : 'Analyze schema'}
        </button>
        {result !== null && <span className="card__hint">Described from a random sample of {result.sampled} documents, not the whole collection.</span>}
      </div>

      {result === null ? (
        <p className="card__hint">Takes a random sample and reports every field, how many documents have it and which types it holds.</p>
      ) : result.fields.length === 0 ? (
        <p className="card__hint">The collection is empty.</p>
      ) : (
        <table className="mgtable mgschema__table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Present</th>
              <th>Types</th>
              <th>Examples</th>
            </tr>
          </thead>
          <tbody>
            {result.fields.map((field) => (
              <tr key={field.path}>
                <td className="dpmono">{field.path}</td>
                <td>{field.presentPercent}%</td>
                <td>
                  {field.types.map((entry) => (
                    <span key={entry.type} className="mgtypechip">
                      {entry.type} {entry.percent < 100 ? `${entry.percent}%` : ''}
                    </span>
                  ))}
                </td>
                <td className="dpmono mgschema__samples">{field.samples.join('   ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
