import { useCallback, useEffect, useRef, useState } from 'react';
import type { TerminalProfile, TerminalSession } from '@shared/schemas/terminal';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { useExitAnimation } from '../../components/useExitAnimation';
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

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Grid for `count` terminals: as square as possible, filling rows top to bottom
 * (2 → side by side, 3 → two above and one below, 5 → three above and two below).
 * Columns are the common multiple of both row widths so a short last row stretches evenly.
 */
function splitLayout(count: number): { columns: number; rows: number; spanOf: (index: number) => number } {
  const perRow = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / perRow));
  const lastRow = Math.max(1, count - perRow * (rows - 1));
  const columns = (perRow * lastRow) / gcd(perRow, lastRow);
  return {
    columns,
    rows,
    spanOf: (index) => (Math.floor(index / perRow) === rows - 1 ? columns / lastRow : columns / perRow)
  };
}

function RenameInput({
  initial,
  onDone
}: {
  initial: string;
  onDone: (title: string | null) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(initial);
  const finished = useRef(false);
  const finish = (title: string | null): void => {
    if (finished.current) return;
    finished.current = true;
    onDone(title);
  };

  return (
    <input
      className="termbar__rename"
      value={draft}
      autoFocus
      maxLength={60}
      aria-label="Terminal name"
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(draft);
        if (event.key === 'Escape') finish(null);
      }}
    />
  );
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
  const split = useTerminalStore((state) =>
    projectId === null ? false : (state.splitByProject[projectId] ?? false)
  );
  const titles = useTerminalStore((state) => state.titles);
  const error = useTerminalStore((state) => state.error);
  const load = useTerminalStore((state) => state.load);
  const create = useTerminalStore((state) => state.create);
  const close = useTerminalStore((state) => state.close);
  const setActive = useTerminalStore((state) => state.setActive);
  const rename = useTerminalStore((state) => state.rename);
  const toggleSplit = useTerminalStore((state) => state.toggleSplit);
  const applyExit = useTerminalStore((state) => state.applyExit);
  const dismissError = useTerminalStore((state) => state.dismissError);

  const [chosenRepositoryId, setRepositoryId] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { closing: menuClosing, requestClose: requestMenuClose } = useExitAnimation();

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

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent): void {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) {
        requestMenuClose(() => setMenuOpen(false));
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen, requestMenuClose]);

  // Opening the tab always leaves a terminal to type in. Once per visit, so closing the last
  // one on purpose does not bring it back.
  const loaded = useTerminalStore((state) => projectId !== null && state.sessionsByProject[projectId] !== undefined);
  const autoOpenedFor = useRef<string | null>(null);
  useEffect(() => {
    if (projectId === null || !loaded || autoOpenedFor.current === projectId) return;
    autoOpenedFor.current = projectId;
    if (sessions.length === 0 && repositoryId !== '') void create(projectId, repositoryId);
  }, [projectId, loaded, sessions.length, repositoryId, create]);

  if (projectId === null) return <div className="panel" />;

  const nameOf = (id: string | null): string =>
    repositories.find((repository) => repository.id === id)?.name ?? 'repository';
  const titleOf = (session: TerminalSession, index: number): string =>
    titles[session.id] ??
    (session.dockerContainer !== null
      ? `${session.profileName} #${index + 1}`
      : session.sshHostId === null
      ? `${session.profileName} · ${nameOf(session.repositoryId)} #${index + 1}`
      : `${session.profileName} #${index + 1}`);
  const active = sessions.find((session) => session.id === activeId) ?? null;
  const showSplit = split && sessions.length > 1;
  const layout = splitLayout(sessions.length);
  const closeMenu = (): void => requestMenuClose(() => setMenuOpen(false));

  return (
    <div className="termpanel">
      {error !== null && <ErrorBanner error={error} onDismiss={dismissError} />}

      <div className="termbar">
        <nav className="subtabs termbar__tabs" aria-label="Terminal sessions">
          {sessions.map((session, index) => (
            <span
              key={session.id}
              className={`termbar__item${session.id === activeId ? ' termbar__item--active' : ''}${session.sshHostId === null ? '' : ' termbar__item--remote'}`}
            >
              {renamingId === session.id ? (
                <RenameInput
                  initial={titleOf(session, index)}
                  onDone={(title) => {
                    setRenamingId(null);
                    if (title !== null) rename(session.id, title);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="termbar__tab"
                  title="Double-click to rename"
                  onClick={() => setActive(projectId, session.id)}
                  onDoubleClick={() => setRenamingId(session.id)}
                >
                  <Icon
                    name={session.dockerContainer !== null ? 'docker' : session.sshHostId === null ? 'terminal' : 'ssh'}
                    size={14}
                  />
                  <span className="termbar__title">{titleOf(session, index)}</span>
                  {session.status === 'exited' && (
                    <span className="termbar__exit">exit {session.exitCode ?? '?'}</span>
                  )}
                </button>
              )}
              <button
                type="button"
                className="iconbutton termbar__close"
                aria-label="Close terminal"
                onClick={() => void close(projectId, session.id)}
              >
                <Icon name="x" size={14} />
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
          <button
            type="button"
            className={`button${showSplit ? ' button--toggled' : ''}`}
            aria-pressed={split}
            disabled={sessions.length < 2}
            title="Show all terminals at once"
            onClick={() => toggleSplit(projectId)}
          >
            <Icon name="split" />
            Split
          </button>
          <div className="termmenu" ref={menuRef}>
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
              onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
            >
              <Icon name="chevronDown" />
            </button>
            {menuOpen && (
              <div className={`termmenu__list${menuClosing ? ' is-closing' : ''}`} role="menu">
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    role="menuitem"
                    className="termmenu__item"
                    onClick={() => {
                      closeMenu();
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
                    closeMenu();
                    setShowSettings(true);
                  }}
                >
                  Manage shells…
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="iconbutton iconbutton--bordered"
            onClick={() => setShowSettings(true)}
            aria-label="Shell settings"
            title="Shell settings"
          >
            <Icon name="gear" />
          </button>
        </div>
      </div>

      {showSettings && (
        <Modal title="Shell settings" className="dialog--settings" onClose={() => setShowSettings(false)}>
          <TerminalSettingsPanel
            projectId={projectId}
            profiles={profiles}
            defaultProfileId={defaultProfileId}
            onChanged={reloadProfiles}
          />
        </Modal>
      )}

      {repositories.length === 0 && (
        <p className="card__hint">
          Add a repository to the project first: a terminal opens in a repository's folder.
        </p>
      )}

      {active?.sshHostId !== undefined && active.sshHostId !== null && (
        <p className="termnotice termnotice--remote">
          <Icon name="ssh" size={13} /> Remote session on <strong>{active.cwd}</strong> — everything you type here runs
          on that machine, not on this one.
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

      <div
        className="termstack"
        style={
          showSplit
            ? {
                gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`
              }
            : undefined
        }
      >
        {sessions.map((session, index) => {
          const isActive = session.id === activeId;
          const modifier = showSplit
            ? ' termstack__item--split'
            : isActive
              ? ''
              : ' termstack__item--hidden';
          return (
            <div
              key={session.id}
              className={`termstack__item${isActive ? ' termstack__item--active' : ''}${modifier}`}
              style={showSplit ? { gridColumn: `span ${layout.spanOf(index)}` } : undefined}
              onMouseDown={() => setActive(projectId, session.id)}
            >
              {showSplit && (
                <div className="termstack__title">
                  <span>{titleOf(session, index)}</span>
                  {session.status === 'exited' && (
                    <span className="termbar__exit">exit {session.exitCode ?? '?'}</span>
                  )}
                </div>
              )}
              <div className="termstack__view">
                <TerminalView session={session} active={isActive} />
              </div>
            </div>
          );
        })}
        {sessions.length === 0 && repositories.length > 0 && (
          <p className="card__hint">No terminals yet. Choose a repository and open one.</p>
        )}
      </div>
    </div>
  );
}
