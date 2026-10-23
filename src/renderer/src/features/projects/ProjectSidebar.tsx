import { useState } from 'react';
import { useAppStore } from '../../stores/app.store';

/**
 * Projects are Steward's root entity: a project owns repositories, tabs and —
 * from later milestones — integrations, environments and execution history.
 */
export function ProjectSidebar(): React.JSX.Element {
  const projects = useAppStore((state) => state.projects);
  const selectedProjectId = useAppStore((state) => state.selectedProjectId);
  const busy = useAppStore((state) => state.busy);
  const selectProject = useAppStore((state) => state.selectProject);
  const createProject = useAppStore((state) => state.createProject);
  const deleteProject = useAppStore((state) => state.deleteProject);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (name.trim() === '') return;

    const created = await createProject(
      description.trim() === '' ? { name: name.trim() } : { name: name.trim(), description: description.trim() }
    );
    if (created) {
      setName('');
      setDescription('');
      setCreating(false);
    }
  }

  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <h1 className="sidebar__brand">Steward</h1>
        <button
          type="button"
          className="button button--small"
          onClick={() => setCreating((value) => !value)}
          aria-expanded={creating}
        >
          {creating ? 'Cancel' : 'New project'}
        </button>
      </header>

      {creating && (
        <form className="project-form" onSubmit={submit}>
          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="field__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Billing platform"
              maxLength={120}
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field__label">Description</span>
            <input
              className="field__input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional"
              maxLength={2000}
            />
          </label>
          <button type="submit" className="button button--primary" disabled={busy || name.trim() === ''}>
            Create project
          </button>
        </form>
      )}

      <nav className="project-list" aria-label="Projects">
        {projects.length === 0 && <p className="sidebar__hint">No projects yet. Create one to begin.</p>}

        {projects.map((project) => {
          const isSelected = project.id === selectedProjectId;
          return (
            <div key={project.id} className={`project-item${isSelected ? ' project-item--active' : ''}`}>
              <button type="button" className="project-item__main" onClick={() => void selectProject(project.id)}>
                <span className="project-item__name">{project.name}</span>
                <span className="project-item__slug">{project.slug}</span>
              </button>

              {confirmingDeleteId === project.id ? (
                <div className="project-item__confirm">
                  <p>
                    Delete <strong>{project.name}</strong> from Steward? Its repository folders on disk are
                    left untouched.
                  </p>
                  <div className="project-item__confirm-actions">
                    <button
                      type="button"
                      className="button button--danger button--small"
                      onClick={() => {
                        setConfirmingDeleteId(null);
                        void deleteProject(project.id);
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => setConfirmingDeleteId(null)}
                    >
                      Keep
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="project-item__delete"
                  onClick={() => setConfirmingDeleteId(project.id)}
                  aria-label={`Delete ${project.name}`}
                  title="Delete project"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
