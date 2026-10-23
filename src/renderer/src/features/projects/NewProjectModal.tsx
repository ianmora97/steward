import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { useAppStore } from '../../stores/app.store';

export function NewProjectModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const busy = useAppStore((state) => state.busy);
  const createProject = useAppStore((state) => state.createProject);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (name.trim() === '') return;

    const created = await createProject(
      description.trim() === '' ? { name: name.trim() } : { name: name.trim(), description: description.trim() }
    );
    if (created) onClose();
  }

  return (
    <Modal title="New project" onClose={onClose}>
      <form className="project-form" onSubmit={submit}>
        <p className="dialog__body">
          A project is an application or system. It can own several repositories, environments and
          integrations.
        </p>
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
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={busy || name.trim() === ''}>
            Create project
          </button>
        </div>
      </form>
    </Modal>
  );
}
