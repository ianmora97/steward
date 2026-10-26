import { useState } from 'react';
import type { Project } from '@shared/schemas/project';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { Icon } from '../../../components/Icon';
import { PROJECT_COLORS, PROJECT_ICONS, ProjectAvatar } from '../../../components/ProjectAvatar';
import { useAppStore } from '../../../stores/app.store';

/** The project's name and look, and the two things that take it out of the way: archive and delete. */
export function GeneralSection({ project }: { project: Project }): React.JSX.Element {
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const showOverview = useAppStore((state) => state.showOverview);
  const deleteProject = useAppStore((state) => state.deleteProject);
  const busy = useAppStore((state) => state.busy);

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [color, setColor] = useState<string | null>(project.color);
  const [icon, setIcon] = useState<string | null>(project.icon);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState<'archive' | 'delete' | null>(null);

  const changed =
    name.trim() !== project.name || description.trim() !== (project.description ?? '') || color !== project.color || icon !== project.icon;

  async function save(): Promise<void> {
    setSaving(true);
    setProblem(null);
    const result = await window.steward.projects.update({
      id: project.id,
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      color,
      icon
    });
    setSaving(false);
    if (!result.success) {
      setProblem(result.error.message);
      return;
    }
    setSaved(true);
    await refreshProjects();
  }

  async function archive(): Promise<void> {
    setConfirming(null);
    const result = await window.steward.projects.archive({ id: project.id });
    if (!result.success) {
      setProblem(result.error.message);
      return;
    }
    await refreshProjects();
    showOverview();
  }

  return (
    <div className="pset__stack">
      <section className="card">
        <h2 className="card__title">Project</h2>
        <div className="pset__identity">
          <ProjectAvatar icon={icon} color={color} size={56} />
          <div className="pset__fields">
            <label className="field">
              <span className="field__label">Name</span>
              <input
                className="field__input"
                value={name}
                maxLength={120}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <label className="field">
              <span className="field__label">Description</span>
              <input
                className="field__input"
                value={description}
                maxLength={2000}
                placeholder="What this project is"
                onChange={(event) => {
                  setDescription(event.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <div className="field">
              <span className="field__label">Slug</span>
              <code className="pset__slug">{project.slug}</code>
            </div>
          </div>
        </div>

        <div className="pset__looks">
          <div className="field">
            <span className="field__label">Colour</span>
            <div className="pset__swatches" role="radiogroup" aria-label="Project colour">
              {PROJECT_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  role="radio"
                  aria-checked={(color ?? PROJECT_COLORS[0]) === swatch}
                  aria-label={swatch}
                  className={`pset__swatch${(color ?? PROJECT_COLORS[0]) === swatch ? ' pset__swatch--on' : ''}`}
                  style={{ background: swatch }}
                  onClick={() => {
                    setColor(swatch);
                    setSaved(false);
                  }}
                />
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field__label">Icon</span>
            <div className="pset__icons" role="radiogroup" aria-label="Project icon">
              {PROJECT_ICONS.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={(icon ?? 'folder') === name}
                  aria-label={name}
                  title={name}
                  className={`pset__icon${(icon ?? 'folder') === name ? ' pset__icon--on' : ''}`}
                  onClick={() => {
                    setIcon(name);
                    setSaved(false);
                  }}
                >
                  <Icon name={name} size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>

        {problem !== null && <p className="dprequired">{problem}</p>}
        <div className="pset__actions">
          <button type="button" className="button button--primary" disabled={!changed || name.trim() === '' || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saved && !changed && <span className="card__hint">Saved.</span>}
        </div>
      </section>

      <section className="card pset__danger">
        <h2 className="card__title">Archive or delete</h2>
        <p className="card__hint">
          Archiving hides the project from the sidebar and the overview and keeps everything. Deleting removes it from Steward, with its
          connections and stored credentials; repository folders on disk are never touched.
        </p>
        <div className="pset__actions">
          <button type="button" className="button" disabled={busy} onClick={() => setConfirming('archive')}>
            Archive project
          </button>
          <button type="button" className="button button--danger" disabled={busy} onClick={() => setConfirming('delete')}>
            Delete project
          </button>
        </div>
      </section>

      {confirming === 'archive' && (
        <ConfirmDialog title={`Archive ${project.name}?`} confirmLabel="Archive" onCancel={() => setConfirming(null)} onConfirm={() => void archive()}>
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
