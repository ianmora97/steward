import { useState } from 'react';
import type { Environment } from '@shared/schemas/environments';
import type { StewardError } from '@shared/types/result';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { Pill } from '../../components/Pill';
import { EnvironmentEditor } from './EnvironmentEditor';
import { KIND_LABEL } from './deployment-meta';

/** The project's environments, in the order the Targets view lists them. */
export function EnvironmentsView({
  projectId,
  environments,
  onChanged,
  onError
}: {
  projectId: string;
  environments: Environment[];
  /** Called with the full, current list after any change. */
  onChanged: (next: Environment[]) => void;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  // `null` closes the editor, `'new'` opens it blank.
  const [editing, setEditing] = useState<Environment | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Environment | null>(null);

  async function reload(): Promise<void> {
    const result = await window.steward.environments.list({ projectId });
    if (result.success) onChanged(result.data);
    else onError(result.error);
  }

  async function move(index: number, direction: -1 | 1): Promise<void> {
    const ids = environments.map((environment) => environment.id);
    const target = index + direction;
    const moved = ids[index];
    const other = ids[target];
    if (moved === undefined || other === undefined) return;
    ids[index] = other;
    ids[target] = moved;
    const result = await window.steward.environments.reorder({ projectId, orderedIds: ids });
    if (result.success) onChanged(result.data);
    else onError(result.error);
  }

  async function remove(environment: Environment): Promise<void> {
    setDeleting(null);
    const result = await window.steward.environments.remove({ id: environment.id });
    if (!result.success) {
      onError(result.error);
      return;
    }
    await reload();
  }

  return (
    <section className="dpsection">
      <div className="dpsection__bar">
        <p className="card__hint">
          Environments group your servers and deploy targets. Protected ones make every deploy ask you to type their
          name.
        </p>
        <button type="button" className="button button--primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={14} /> New environment
        </button>
      </div>

      {environments.length === 0 ? (
        <EmptyState
          title="No environments yet"
          description="Create the first one (for example Production) to start adding deploy targets."
        />
      ) : (
        <ul className="dplist">
          {environments.map((environment, index) => (
            <li key={environment.id} className="dpitem">
              <span className="dpitem__name">{environment.name}</span>
              <Pill tone="neutral">{KIND_LABEL[environment.kind]}</Pill>
              {environment.isProtected && (
                <Pill tone="warning" icon="shield">
                  Protected
                </Pill>
              )}
              <span className="dpitem__spacer" />
              <button
                type="button"
                className="iconbutton"
                aria-label={`Move ${environment.name} up`}
                disabled={index === 0}
                onClick={() => void move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="iconbutton"
                aria-label={`Move ${environment.name} down`}
                disabled={index === environments.length - 1}
                onClick={() => void move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="iconbutton"
                aria-label={`Edit ${environment.name}`}
                onClick={() => setEditing(environment)}
              >
                <Icon name="edit" size={15} />
              </button>
              <button
                type="button"
                className="iconbutton"
                aria-label={`Delete ${environment.name}`}
                onClick={() => setDeleting(environment)}
              >
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing !== null && (
        <EnvironmentEditor
          projectId={projectId}
          environment={editing === 'new' ? null : editing}
          onSaved={() => void reload()}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting !== null && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete environment"
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        >
          <p>
            Servers in {deleting.name} keep existing but lose their environment. An environment that still has deploy
            targets or deployment history cannot be deleted.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
