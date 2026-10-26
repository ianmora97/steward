import { useEffect, useState } from 'react';
import type {
  MongoAggregateResult,
  MongoConnection,
  MongoExplainSummary,
  MongoSavedQuery
} from '@shared/schemas/mongodb';
import type { StewardError } from '@shared/types/result';
import { Icon } from '../../components/Icon';
import { DocumentResults, ViewSwitch, type DocumentViewMode } from './DocumentViews';
import { ExplainPanel } from './ExplainPanel';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { toast } from '../../stores/toast.store';

interface Stage {
  id: number;
  text: string;
}

const TEMPLATES: Record<string, string> = {
  $match: '{ $match: {  } }',
  $group: '{ $group: { _id: "$field", count: { $sum: 1 } } }',
  $project: '{ $project: { field: 1 } }',
  $sort: '{ $sort: { field: -1 } }',
  $limit: '{ $limit: 10 }',
  $skip: '{ $skip: 0 }',
  $unwind: '{ $unwind: "$field" }',
  $lookup: '{ $lookup: { from: "other", localField: "field", foreignField: "_id", as: "joined" } }',
  $addFields: '{ $addFields: { field: "$other" } }',
  $count: '{ $count: "total" }'
};

type Output = { result: MongoAggregateResult | null; error: StewardError | null };

function pipelineText(stages: readonly Stage[]): string {
  return `[\n${stages.map((stage) => stage.text.trim()).join(',\n')}\n]`;
}

/**
 * A pipeline built stage by stage. Previewing a stage runs the pipeline up to it (and no further than 20
 * documents), so each step can be checked on its own. `$out` and `$merge` write, so they need a tick.
 */
export function AggregationView({
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
  const [stages, setStages] = useState<Stage[]>([{ id: 1, text: '{ $match: {  } }' }]);
  const [nextId, setNextId] = useState(2);
  const [template, setTemplate] = useState('$match');
  const [previews, setPreviews] = useState<Record<number, Output>>({});
  const [output, setOutput] = useState<Output | null>(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<DocumentViewMode>('list');
  const [allowDiskUse, setAllowDiskUse] = useState(false);
  const [confirmedWrite, setConfirmedWrite] = useState(false);
  const [explain, setExplain] = useState<MongoExplainSummary | null>(null);
  const [saved, setSaved] = useState<MongoSavedQuery[]>([]);
  const [savedReload, setSavedReload] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.steward.mongo.listSavedQueries({ connectionId: connection.id, db, collection }).then((result) => {
      if (!cancelled && result.success) setSaved(result.data.filter((query) => query.kind === 'aggregate'));
    });
    return () => {
      cancelled = true;
    };
  }, [connection.id, db, collection, savedReload]);

  const writes = stages.some((stage) => /\$(out|merge)\b/.test(stage.text));
  const blockedByReadOnly = writes && connection.readOnly;

  function update(id: number, text: string): void {
    setStages((current) => current.map((stage) => (stage.id === id ? { ...stage, text } : stage)));
  }

  function move(index: number, by: -1 | 1): void {
    setStages((current) => {
      const target = index + by;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (moved !== undefined) next.splice(target, 0, moved);
      return next;
    });
    setPreviews({});
  }

  async function preview(index: number, id: number): Promise<void> {
    const result = await window.steward.mongo.aggregate({
      connectionId: connection.id,
      db,
      collection,
      pipeline: pipelineText(stages),
      previewUpToStage: index,
      allowDiskUse
    });
    setPreviews((current) => ({ ...current, [id]: { result: result.success ? result.data : null, error: result.success ? null : result.error } }));
  }

  async function run(): Promise<void> {
    setRunning(true);
    setOutput(null);
    const result = await window.steward.mongo.aggregate({
      connectionId: connection.id,
      db,
      collection,
      pipeline: pipelineText(stages),
      allowDiskUse,
      ...(writes && confirmedWrite ? { confirmedWrite: true } : {})
    });
    setRunning(false);
    setOutput({ result: result.success ? result.data : null, error: result.success ? null : result.error });
    if (!result.success) onError(result.error);
  }

  async function runExplain(): Promise<void> {
    const result = await window.steward.mongo.explainAggregate({ connectionId: connection.id, db, collection, pipeline: pipelineText(stages) });
    if (result.success) setExplain(result.data);
    else onError(result.error);
  }

  async function save(name: string): Promise<void> {
    const result = await window.steward.mongo.saveQuery({
      connectionId: connection.id,
      db,
      collection,
      name,
      kind: 'aggregate',
      body: { pipeline: JSON.stringify(stages.map((stage) => stage.text)) }
    });
    if (!result.success) onError(result.error);
    else {
      toast.success('Pipeline saved');
      setSaving(null);
      setSavedReload((value) => value + 1);
    }
  }

  function load(query: MongoSavedQuery): void {
    try {
      const texts = JSON.parse(query.body.pipeline ?? '[]') as unknown;
      if (!Array.isArray(texts) || texts.some((item) => typeof item !== 'string')) return;
      const loaded = (texts as string[]).map((text, index) => ({ id: nextId + index, text }));
      setStages(loaded.length === 0 ? [{ id: nextId, text: '{ $match: {  } }' }] : loaded);
      setNextId(nextId + Math.max(1, loaded.length));
      setPreviews({});
      setOutput(null);
    } catch {
      // A saved pipeline that cannot be read is left alone.
    }
  }

  return (
    <section className="mgagg">
      <div className="mgsaved">
        <select
          className="field__input"
          value=""
          onChange={(event) => {
            const query = saved.find((candidate) => candidate.id === event.target.value);
            if (query !== undefined) load(query);
          }}
          aria-label="Saved pipelines"
        >
          <option value="">Saved pipelines ({saved.length})</option>
          {saved.map((query) => (
            <option key={query.id} value={query.id}>
              {query.name}
            </option>
          ))}
        </select>
        {saving === null ? (
          <Button size="sm" onClick={() => setSaving('')}>
            Save this pipeline
          </Button>
        ) : (
          <form
            className="mgsaved__form"
            onSubmit={(event) => {
              event.preventDefault();
              if (saving.trim() !== '') void save(saving.trim());
            }}
          >
            <input className="field__input" value={saving} onChange={(event) => setSaving(event.target.value)} placeholder="Name" autoFocus />
            <Button variant="primary" size="sm" type="submit">Save</Button>
            <Button size="sm" onClick={() => setSaving(null)}>Cancel</Button>
          </form>
        )}
        {saved.length > 0 && (
          <details className="mgsaved__manage">
            <summary>Manage</summary>
            <ul>
              {saved.map((query) => (
                <li key={query.id}>
                  {query.name}
                  <IconButton icon="trash" label={`Delete saved pipeline ${query.name}`} size={14} onClick={() =>
                      void window.steward.mongo.deleteSavedQuery({ id: query.id }).then((result) => {
                        if (result.success) {
                          toast.success('Saved pipeline deleted');
                          setSavedReload((value) => value + 1);
                        } else onError(result.error);
                      })
                    } />
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <ol className="mgstages">
        {stages.map((stage, index) => {
          const shown = previews[stage.id];
          return (
            <li key={stage.id} className="mgstage">
              <header className="mgstage__head">
                <strong>Stage {index + 1}</strong>
                <span className="dpitem__spacer" />
                <IconButton icon="chevronUp" label="Move stage up" disabled={index === 0} onClick={() => move(index, -1)} />
                <IconButton icon="chevronDown" label="Move stage down" disabled={index === stages.length - 1} onClick={() => move(index, 1)} />
                <Button size="sm" onClick={() => void preview(index, stage.id)}>
                  Preview
                </Button>
                <IconButton icon="trash" label="Remove stage" disabled={stages.length === 1} size={14} onClick={() => {
                    setStages((current) => current.filter((candidate) => candidate.id !== stage.id));
                    setPreviews({});
                  }} />
              </header>
              <textarea className="field__input dpmono mgstage__text" value={stage.text} onChange={(event) => update(stage.id, event.target.value)} spellCheck={false} aria-label={`Stage ${index + 1}`} />
              {shown !== undefined && (
                <div className="mgstage__preview">
                  {shown.error !== null ? (
                    <p className="dprequired">{shown.error.message}{shown.error.details === undefined ? '' : ` — ${shown.error.details}`}</p>
                  ) : (
                    <>
                      <p className="card__hint">Output of stages 1–{index + 1} (first 20 documents)</p>
                      <DocumentResults documents={shown.result?.documents ?? []} mode="json" actions={null} readOnly />
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mgagg__bar">
        <select className="field__input" value={template} onChange={(event) => setTemplate(event.target.value)} aria-label="Stage type">
          {Object.keys(TEMPLATES).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={() => {
            setStages((current) => [...current, { id: nextId, text: TEMPLATES[template] ?? '{  }' }]);
            setNextId(nextId + 1);
          }}>
          <Icon name="plus" size={14} /> Add stage
        </Button>
        <label className="dpcheck">
          <input type="checkbox" checked={allowDiskUse} onChange={(event) => setAllowDiskUse(event.target.checked)} />
          <span>Allow disk use</span>
        </label>
        <span className="dpitem__spacer" />
        <Button onClick={() => void runExplain()}>
          Explain
        </Button>
        <Button variant="primary" loading={running} loadingLabel="Running…" disabled={blockedByReadOnly || (writes && !confirmedWrite)} onClick={() => void run()}>Run pipeline</Button>
      </div>

      {writes && (
        <label className="dpcheck">
          <input type="checkbox" checked={confirmedWrite} disabled={connection.readOnly} onChange={(event) => setConfirmedWrite(event.target.checked)} />
          <span>
            <Icon name="alert" size={14} /> This pipeline has <code>$out</code> or <code>$merge</code>, which write to the database.
            {connection.readOnly ? ' This connection is read-only, so it cannot run.' : ' I allow it to write.'}
          </span>
        </label>
      )}

      {explain !== null && <ExplainPanel summary={explain} onClose={() => setExplain(null)} />}

      {output !== null && (
        <div className="mgagg__output">
          <div className="mgtoolbar">
            <strong>Result</strong>
            <ViewSwitch mode={mode} onChange={setMode} />
            {output.result !== null && (
              <span className="card__hint">
                {output.result.documents.length} document{output.result.documents.length === 1 ? '' : 's'}
                {output.result.truncated ? ' (cut: first 1000 / 4 MB)' : ''} · {output.result.elapsedMs} ms
              </span>
            )}
          </div>
          {output.error !== null ? (
            <p className="dprequired">{output.error.message}{output.error.details === undefined ? '' : ` — ${output.error.details}`}</p>
          ) : (
            <DocumentResults documents={output.result?.documents ?? []} mode={mode} actions={null} readOnly />
          )}
        </div>
      )}
    </section>
  );
}
