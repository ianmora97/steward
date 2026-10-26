import { useEffect, useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { Icon, type IconName } from '../../components/Icon';
import { useAppStore, type SettingsSection } from '../../stores/app.store';
import { GeneralSection } from './settings/GeneralSection';
import { IntegrationsSection } from './settings/IntegrationsSection';
import { ServicesSection } from './settings/ServicesSection';
import { WorkspaceSection } from './settings/WorkspaceSection';
import './settings.css';

const SECTIONS: Array<{ key: SettingsSection; label: string; icon: IconName; hint: string }> = [
  { key: 'general', label: 'General', icon: 'settings', hint: 'Name, look, archive' },
  { key: 'services', label: 'Services', icon: 'panel', hint: 'What is on the tab bar' },
  { key: 'integrations', label: 'Integrations', icon: 'plug', hint: 'GitHub account' },
  { key: 'workspace', label: 'Workspace', icon: 'folder', hint: 'Repositories, shell, environments' }
];

/** A project's settings, in sections. Everything is stored locally, per project. */
export function WorkspaceSettings(): React.JSX.Element {
  const projects = useAppStore((state) => state.projects);
  const projectId = useAppStore((state) => state.selectedProjectId);
  const requested = useAppStore((state) => state.requestedSettingsSection);
  const clearRequest = useAppStore((state) => state.clearSettingsRequest);
  const [section, setSection] = useState<SettingsSection>('general');

  // "Manage repositories" and the like ask for a section: take it now, and clear the request so it is used once.
  if (requested !== null && requested !== section) setSection(requested);
  useEffect(() => {
    if (requested !== null) clearRequest();
  }, [requested, clearRequest]);

  const project = projects.find((candidate) => candidate.id === projectId) ?? null;
  if (project === null) return <EmptyState title="No project selected" description="Pick a project to change its settings." />;

  return (
    <div className="pset">
      <nav className="pset__nav" aria-label="Settings sections">
        {SECTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`pset__navitem${section === item.key ? ' pset__navitem--active' : ''}`}
            aria-current={section === item.key ? 'page' : undefined}
            onClick={() => setSection(item.key)}
          >
            <Icon name={item.icon} size={17} />
            <span className="pset__navtext">
              <span className="pset__navname">{item.label}</span>
              <span className="pset__navhint">{item.hint}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="pset__content">
        {/* Keyed by project so switching projects never shows one project's form with another's data. */}
        {section === 'general' && <GeneralSection key={project.id} project={project} />}
        {section === 'services' && <ServicesSection />}
        {section === 'integrations' && <IntegrationsSection key={project.id} projectId={project.id} />}
        {section === 'workspace' && <WorkspaceSection key={project.id} projectId={project.id} />}
      </div>
    </div>
  );
}
