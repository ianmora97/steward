import { useCallback, useEffect, useState } from 'react';
import type { TerminalProfile, TerminalSession } from '@shared/schemas/terminal';
import { ErrorBanner } from '../../components/ErrorBanner';
import { useAppStore } from '../../stores/app.store';
import { useTerminalStore } from '../../stores/terminal.store';
import { TerminalSettingsPanel } from './TerminalSettingsPanel';
import { TerminalView } from './TerminalView';
import './terminal.css';

const REFRESH_MS = 3000;
const NO_SESSIONS: TerminalSession[] = [];

async function fetchProfiles(
  projectId: string
): Promise<{ profiles: TerminalProfile[]; defaultProfileId: string | null }> {
  const [listed, settings] = await Promise.all([
    window.steward.terminal.listProfiles(),
    window.steward.terminal.getSettings({ projectId })
  ]);
  return {
    profiles: listed.success ? listed.data : [],
    defaultProfileId: settings.success ? settings.data.defaultProfileId : null
  };
}

export function TerminalPanel(): React.JSX.Element {
  const projectId = useAppStore((state) => state.selectedProjectId);
  const repositories = useAppStore((state) => state.repositories);
  const sessions = useTerminalStore((state) =>
    projectId === null ? NO_SESSIONS : (state.sessionsByProject[projectId] ?? NO_SESSIONS)
  );
  const activeId = useTerminalStore((state) =>
    projectId === null ? null : (state.activeByProject[projectId] ?? null)
  );
  const error = useTerminalStore((state) => state.error);
  const load = useTerminalStore((state) => state.load);
  const create = useTerminalStore((state) => state.create);
  const close = useTerminalStore((state) => state.close);
  const setActive = useTerminalStore((state) => state.setActive);
  const applyExit = useTerminalStore((state) => state.applyExit);
  const dismissError = useTerminalStore((state) => state.dismissError);

  const [chosenRepositoryId, setRepositoryId] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);

  const reloadProfiles = useCallback(async (): Promise<void> => {
    if (projectId === null) return;
    const loaded = await fetchProfiles(projectId);
    setProfiles(loaded.profiles);
    setDefaultProfileId(loaded.defaultProfileId);
  }, [projectId]);

  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    void fetchProfiles(projectId).then((loaded) => {
      if (cancelled) return;
      setProfiles(loaded.profiles);
      setDefaultProfileId(loaded.defaultProfileId);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // The choice can outlive its repository (removed, or another project): fall back to the first one.
  const repositoryId = repositories.some((repository) => repository.id === chosenRepositoryId)
    ? chosenRepositoryId
    : (repositories[0]?.id ?? '');

  useEffect(() => {
    if (projectId === null) return;
    void load(projectId);
    // The truncated flag has no push event of its own, so it is picked up by polling.
    const timer = setInterval(() => void load(projectId), REFRESH_MS);
    const unsubscribe = window.steward.terminal.onExit((event) => applyExit(event.sessionId, event.exitCode));
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [projectId, load, applyExit]);

  if (projectId === null) return <div className="panel" />;

  const nameOf = (id: string): string =>
    repositories.find((repository) => repository.id === id)?.name ?? 'repository';
  const active = sessions.find((session) => session.id === activeId) ?? null;

  return (
    <div className="termpanel">
      {error !== null && <ErrorBanner error={error} onDismiss={dismissError} />}

      <div className="termbar">
        <nav className="subtabs termbar__tabs" aria-label="Terminal sessions">
          {sessions.map((session, index) => (
            <span key={session.id} className="termbar__item">
              <button
                type="button"
                className={`subtabs__tab${session.id === activeId ? ' subtabs__tab--active' : ''}`}
                onClick={() => setActive(projectId, session.id)}
              >
                {session.profileName} · {nameOf(session.repositoryId)} #{index + 1}
                {session.status === 'exited' && ` (exit ${session.exitCode ?? '?'})`}
              </button>
              <button
                type="button"
                className="button button--ghost button--small"
                aria-label="Close terminal"
                onClick={() => void close(projectId, session.id)}
              >
                ×
              </button>
            </span>
          ))}
        </nav>
        <div className="termbar__new">
          <select
            className="field__input"
            value={repositoryId}
            onChange={(event) => setRepositoryId(event.target.value)}
            aria-label="Repository for the new terminal"
          >
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.name}
              </option>
            ))}
          </select>
          <div className="termmenu">
            <button
              type="button"
              className="button button--primary"
              disabled={repositoryId === ''}
              onClick={() => void create(projectId, repositoryId)}
            >
              New terminal
            </button>
            <button
              type="button"
              className="button button--primary termmenu__toggle"
              disabled={repositoryId === ''}
              aria-label="Choose a shell"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              ▾
            </button>
            {menuOpen && (
              <div className="termmenu__list" role="menu">
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    role="menuitem"
                    className="termmenu__item"
                    onClick={() => {
                      setMenuOpen(false);
                      void create(projectId, repositoryId, profile.id);
                    }}
                  >
                    {profile.name}
                    {profile.id === defaultProfileId ? ' (default)' : ''}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  className="termmenu__item termmenu__item--settings"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowSettings(true);
                  }}
                >
                  Manage shells…
                </button>
              </div>
            )}
          </div>
          <button type="button" className="button" onClick={() => setShowSettings((value) => !value)}>
            Shells
          </button>
        </div>
      </div>

      {showSettings && (
        <TerminalSettingsPanel
          projectId={projectId}
          profiles={profiles}
          defaultProfileId={defaultProfileId}
          onChanged={reloadProfiles}
        />
      )}

      {repositories.length === 0 && (
        <p className="card__hint">
          Add a repository to the project first: a terminal opens in a repository's folder.
        </p>
      )}

      {active?.truncated === true && (
        <p className="termnotice">
          Output passed the 5 MB log limit: the rest is shown here but is no longer saved to the log.
        </p>
      )}
      {active?.status === 'exited' && (
        <p className="termnotice">
          The shell exited with code {active.exitCode ?? 'unknown'}. Close this tab or open a new terminal.
        </p>
      )}

      <div className="termstack">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`termstack__item${session.id === activeId ? ' termstack__item--active' : ''}`}
          >
            <TerminalView session={session} active={session.id === activeId} />
          </div>
        ))}
        {sessions.length === 0 && repositories.length > 0 && (
          <p className="card__hint">No terminals yet. Choose a repository and open one.</p>
        )}
      </div>
    </div>
  );
}
