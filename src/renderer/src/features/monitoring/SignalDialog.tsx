import { useState } from 'react';
import type { ObservabilityServiceEntry, ObservabilitySignal, SignalKind } from '@shared/schemas/observability';
import { fail, type StewardError } from '@shared/types/result';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useAction } from '../../components/useAction';

const KIND_LABEL: Record<SignalKind, string> = { promql: 'PromQL (metrics)', logql_metric: 'LogQL (from logs)' };

export function SignalDialog({
  projectId,
  existing,
  services,
  onClose,
  onSaved
}: {
  projectId: string;
  existing: ObservabilitySignal | null;
  services: ObservabilityServiceEntry[];
  onClose: () => void;
  onSaved: (signal: ObservabilitySignal) => void;
}): React.JSX.Element {
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<SignalKind>(existing?.kind ?? 'promql');
  const [unit, setUnit] = useState(existing?.unit ?? '');
  const [queryTemplate, setQueryTemplate] = useState(existing?.queryTemplate ?? '');
  const [previewServiceId, setPreviewServiceId] = useState(services[0]?.id ?? '');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<StewardError | null>(null);

  const save = useAction(
    async () => {
      if (name.trim() === '') return fail<ObservabilitySignal>('VALIDATION_FAILED', 'Give the signal a name.');
      const fields = { name: name.trim(), kind, queryTemplate, unit: unit.trim() };
      return existing === null
        ? window.steward.observability.createSignal({ projectId, ...fields })
        : window.steward.observability.updateSignal({ id: existing.id, ...fields });
    },
    { success: existing === null ? 'Signal added' : 'Signal saved', errorTarget: 'none' }
  );

  async function onPreview(): Promise<void> {
    setPreview(null);
    setPreviewError(null);
    const result = await window.steward.observability.previewSignal({ serviceId: previewServiceId, queryTemplate });
    if (result.success) setPreview(result.data.query);
    else setPreviewError(result.error);
  }

  async function onSave(): Promise<void> {
    const saved = await save.run();
    if (saved !== undefined) onSaved(saved);
  }

  const placeholder = kind === 'promql' ? 'sum(rate(http_requests_total{ {{matcher}} }[5m]))' : 'sum(rate({{selector}} |= "error" [1m]))';

  return (
    <Modal title={existing === null ? 'New signal' : `Edit ${existing.name}`} onClose={onClose} className="mgconn">
      <div className="mgconn__body">
        <div className="mnrow">
          <Field label="Name" required>
            <input className="field__input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Request rate" autoFocus />
          </Field>
          <Field label="Unit" hint="Shown on the axis, such as %, s or B.">
            <input className="field__input" value={unit} onChange={(event) => setUnit(event.target.value)} maxLength={16} />
          </Field>
        </div>

        <div className="segmented" role="group" aria-label="Kind of query">
          {(Object.keys(KIND_LABEL) as SignalKind[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`segmented__option${kind === value ? ' segmented__option--active' : ''}`}
              onClick={() => setKind(value)}
            >
              {KIND_LABEL[value]}
            </button>
          ))}
        </div>

        <Field
          label="Query"
          required
          hint={
            kind === 'promql'
              ? 'Use {{matcher}} where the service’s labels go: http_requests_total{ {{matcher}} }.'
              : 'Use {{selector}} for the service’s log selector: rate({{selector}} |= "error" [1m]).'
          }
        >
          <textarea
            className="field__input mnquery"
            rows={4}
            value={queryTemplate}
            onChange={(event) => setQueryTemplate(event.target.value)}
            placeholder={placeholder}
            spellCheck={false}
          />
        </Field>

        {services.length > 0 && (
          <div className="mnbuilder">
            <select className="field__input mnselect" value={previewServiceId} onChange={(event) => setPreviewServiceId(event.target.value)} aria-label="Service to preview">
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                  {service.environmentName === null ? '' : ` · ${service.environmentName}`}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={queryTemplate.trim() === ''} onClick={() => void onPreview()}>
              Preview the query
            </Button>
          </div>
        )}
        {preview !== null && <pre className="mndetail__raw mnpreview">{preview}</pre>}
        {previewError !== null && (
          <div className="banner banner--error" role="alert">
            <span className="banner__message">{previewError.message}</span>
            {previewError.details !== undefined && <span className="banner__details">{previewError.details}</span>}
          </div>
        )}

        {save.error !== null && (
          <div className="banner banner--error" role="alert">
            <span className="banner__message">{save.error.message}</span>
            {save.error.details !== undefined && <span className="banner__details">{save.error.details}</span>}
          </div>
        )}

        <div className="dialog__actions">
          <span className="dpitem__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.pending} loadingLabel="Saving…" disabled={name.trim() === '' || queryTemplate.trim() === ''} onClick={() => void onSave()}>
            {existing === null ? 'Save signal' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
