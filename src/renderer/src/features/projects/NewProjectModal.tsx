import { useId, useState } from 'react';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useAppStore } from '../../stores/app.store';

export function NewProjectModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const busy = useAppStore((state) => state.busy);
  const createProject = useAppStore((state) => state.createProject);
  const nameId = useId();
  const descriptionId = useId();

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
        <Field label="Name" htmlFor={nameId}>
          <input
            id={nameId}
            className="field__input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Billing platform"
            maxLength={120}
            autoFocus
          />
        </Field>
        <Field label="Description" htmlFor={descriptionId}>
          <input
            id={descriptionId}
            className="field__input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional"
            maxLength={2000}
          />
        </Field>
        <div className="dialog__actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" loading={busy} loadingLabel="Creating…" disabled={name.trim() === ''}>
            Create project
          </Button>
        </div>
      </form>
    </Modal>
  );
}
