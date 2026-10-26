import { useId, useState } from 'react';
import type { Project } from '@shared/schemas/project';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Field } from '../../../components/Field';
import { Icon } from '../../../components/Icon';
import { DEFAULT_PROJECT_COLOR, PROJECT_COLORS, PROJECT_ICONS, ProjectAvatar } from '../../../components/ProjectAvatar';
import { useAction } from '../../../components/useAction';
import { useAppStore } from '../../../stores/app.store';
import { ZoomSelector } from './ZoomSelector';

function iconLabel(name: string): string {
  const spaced = name.replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The project's name and look, the window's zoom, and the two things that take a project out of the way: archive and delete. */
export function GeneralSection({ project }: { project: Project }): React.JSX.Element {
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const showOverview = useAppStore((state) => state.showOverview);
  const deleteProject = useAppStore((state) => state.deleteProject);
  const busy = useAppStore((state) => state.busy);
  const nameId = useId();
  const descriptionId = useId();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [color, setColor] = useState<string | null>(project.color);
  const [icon, setIcon] = useState<string | null>(project.icon);
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null);

  const changed =
    name.trim() !== project.name || description.trim() !== (project.description ?? '') || color !== project.color || icon !== project.icon;

  const save = useAction(
    async () => {
      const result = await window.steward.projects.update({
        id: project.id,
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        color,
        icon
      });
      if (result.success) await refreshProjects();
      return result;
    },
    { success: 'Settings saved', errorTarget: 'none' }
  );

  const archive = useAction(
    async () => {
      const result = await window.steward.projects.archive({ id: project.id });
      if (result.success) {
        await refreshProjects();
        showOverview();
      }
      return result;
    },
    { success: 'Project archived' }
  );

  return (
    <div className="pset__stack">
      <Card>
        <Card.Header title="Project" />
        <div className="pset__identity">
          <ProjectAvatar icon={icon} color={color} size={56} />
          <div className="pset__fields">
            <Field label="Name" htmlFor={nameId}>
              <input id={nameId} className="field__input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Description" htmlFor={descriptionId}>
              <input
                id={descriptionId}
                className="field__input"
                value={description}
                maxLength={2000}
                placeholder="What this project is"
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field label="Slug">
              <code className="pset__slug">{project.slug}</code>
            </Field>
          </div>
        </div>

        <div className="pset__looks" style={{ ['--pick' as string]: color ?? DEFAULT_PROJECT_COLOR }}>
          <Field label="Colour">
            <div className="pset__swatches" role="radiogroup" aria-label="Project colour">
              {PROJECT_COLORS.map((swatch) => {
                const on = (color ?? DEFAULT_PROJECT_COLOR) === swatch.value;
                return (
                  <button
                    key={swatch.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={swatch.name}
                    title={swatch.name}
                    className={`pset__swatch${on ? ' pset__swatch--on' : ''}`}
                    style={{ background: swatch.value }}
                    onClick={() => setColor(swatch.value)}
                  />
                );
              })}
            </div>
          </Field>
          <Field label="Icon">
            <div className="pset__icons" role="radiogroup" aria-label="Project icon">
              {PROJECT_ICONS.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={(icon ?? 'folder') === choice}
                  aria-label={iconLabel(choice)}
                  title={iconLabel(choice)}
                  className={`pset__icon${(icon ?? 'folder') === choice ? ' pset__icon--on' : ''}`}
                  onClick={() => setIcon(choice)}
                >
                  <Icon name={choice} size={16} />
                </button>
              ))}
            </div>
          </Field>
        </div>

        {save.error !== null && <p className="dprequired">{save.error.message}</p>}
        <Card.Footer>
          <Button variant="primary" loading={save.pending} loadingLabel="Saving…" disabled={!changed || name.trim() === ''} onClick={() => void save.run()}>
            Save changes
          </Button>
        </Card.Footer>
      </Card>

      <Card>
        <Card.Header title="Appearance" />
        <p className="card__hint">Scales the whole interface, text included. Ctrl + and Ctrl − do the same from the keyboard, and Ctrl 0 goes back to 100 %.</p>
        <Field label="Zoom">
          <ZoomSelector />
        </Field>
      </Card>

      <Card className="pset__danger">
        <Card.Header title="Archive or delete" />
        <p className="card__hint">
          Archiving hides the project from the sidebar and the overview and keeps everything. Deleting removes it from Steward, with its
          connections and stored credentials; repository folders on disk are never touched.
        </p>
        <div className="pset__actions">
          <Button disabled={busy} onClick={() => setConfirming('archive')}>
            Archive project
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => setConfirming('delete')}>
            Delete project
          </Button>
        </div>
      </Card>

      {confirming === 'archive' && (
        <ConfirmDialog
          title={`Archive ${project.name}?`}
          confirmLabel="Archive"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void archive.run();
          }}
        >
          <p>It disappears from the sidebar and the overview. Nothing is deleted.</p>
        </ConfirmDialog>
      )}
      {confirming === 'delete' && (
        <ConfirmDialog
          title={`Delete ${project.name}?`}
          confirmLabel="Delete project"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            void deleteProject(project.id);
          }}
        >
          <p>
            The project, its connections (VPC, databases, deploy targets) and their stored credentials are removed from Steward. This cannot be
            undone. Repository folders on disk are left untouched.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
