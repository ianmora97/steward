import { useCallback, useEffect, useState } from 'react';
import type { Environment } from '@shared/schemas/environments';
import type { TerminalProfile } from '@shared/schemas/terminal';
import type { StewardError } from '@shared/types/result';
import { Card } from '../../../components/Card';
import { ErrorBanner } from '../../../components/ErrorBanner';
import { useAppStore } from '../../../stores/app.store';
import { EnvironmentsView } from '../../deployments/EnvironmentsView';
import { RepositoryPanel } from '../../repositories/RepositoryPanel';
import { TerminalSettingsPanel } from '../../terminal/TerminalSettingsPanel';

/** What the project is made of on this machine: its repositories, the shell its terminals start, and its environments. */
export function WorkspaceSection({ projectId }: { projectId: string }): React.JSX.Element {
  const appInfo = useAppStore((state) => state.appInfo);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [error, setError] = useState<StewardError | null>(null);

  const loadProfiles = useCallback(async (): Promise<void> => {
    const [listed, settings] = await Promise.all([
      window.steward.terminal.listProfiles(),
      window.steward.terminal.getSettings({ projectId })
    ]);
    if (listed.success) setProfiles(listed.data);
    if (settings.success) setDefaultProfileId(settings.data.defaultProfileId);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.steward.environments.list({ projectId }),
      window.steward.terminal.listProfiles(),
      window.steward.terminal.getSettings({ projectId })
    ]).then(([envs, listed, settings]) => {
      if (cancelled) return;
      if (envs.success) setEnvironments(envs.data);
      else setError(envs.error);
      if (listed.success) setProfiles(listed.data);
      if (settings.success) setDefaultProfileId(settings.data.defaultProfileId);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="pset__stack">
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <Card>
        <Card.Header title="Repositories" />
        <p className="card__hint">The folders on this machine that make up the project. Git and GitHub read them; Steward never moves or edits them.</p>
        <RepositoryPanel />
      </Card>

      <Card>
        <Card.Header title="Terminal" />
        <TerminalSettingsPanel projectId={projectId} profiles={profiles} defaultProfileId={defaultProfileId} onChanged={loadProfiles} />
      </Card>

      <Card>
        <Card.Header title="Environments" />
        <p className="card__hint">Production, Staging… Servers and deploy targets belong to one. A protected environment asks you to type its name before anything runs.</p>
        <EnvironmentsView projectId={projectId} environments={environments} onChanged={setEnvironments} onError={setError} />
      </Card>

      {appInfo !== null && (
        <Card muted>
          <Card.Header title="Local storage" />
          <dl className="probe__facts">
            <div>
              <dt>Database</dt>
              <dd>{appInfo.databasePath}</dd>
            </div>
            <div>
              <dt>Driver</dt>
              <dd>{appInfo.databaseDriver}</dd>
            </div>
            <div>
              <dt>Schema version</dt>
              <dd>v{appInfo.schemaVersion}</dd>
            </div>
          </dl>
          <p className="card__hint">
            Steward stores its own configuration and execution records only. Git and provider data are read from Git and the provider APIs, never treated as a
            local system of record.
          </p>
        </Card>
      )}
    </div>
  );
}
