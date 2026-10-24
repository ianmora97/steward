import { useAppStore } from '../../stores/app.store';
import { Icon } from '../../components/Icon';
import { FIXED_LAST_TAB, tabIcon, tabLabel } from './TabBar';

/**
 * Tab layout is a stored preference, so reordering, hiding and restoring are
 * ordinary edits that survive a restart. The Git tab can be moved but not
 * hidden: every project keeps it.
 */
export function WorkspaceSettings(): React.JSX.Element {
  const tabs = useAppStore((state) => state.tabs);
  const busy = useAppStore((state) => state.busy);
  const moveTab = useAppStore((state) => state.moveTab);
  const setTabVisibility = useAppStore((state) => state.setTabVisibility);
  const restoreTabs = useAppStore((state) => state.restoreTabs);
  const appInfo = useAppStore((state) => state.appInfo);

  const ordered = [...tabs]
    .sort((a, b) => a.position - b.position)
    .filter((tab) => tab.tabKey !== FIXED_LAST_TAB);
  const fixedTab = tabs.find((tab) => tab.tabKey === FIXED_LAST_TAB);

  return (
    <div className="panel">
      <section className="card">
        <h2 className="card__title">Tabs</h2>
        <p className="card__hint">
          Reorder or hide the tabs of this project; Settings always stays last, on the right. Preferences are stored locally per project. Tabs for
          GitHub, SSH, Actions and deployments appear here once those integrations are configured.
        </p>

        <ul className="tab-admin">
          {ordered.map((tab, index) => (
            <li key={tab.id} className="tab-admin__row">
              <span className="tab-admin__position">{index + 1}</span>
              <span className="tab-admin__name">
                <Icon name={tabIcon(tab.tabKey)} />
                {tabLabel(tab.tabKey)}
                {tab.pinned && <span className="chip chip--pinned">always on</span>}
              </span>

              <div className="tab-admin__actions">
                <button
                  type="button"
                  className="button button--small"
                  onClick={() => void moveTab(tab.tabKey, -1)}
                  disabled={busy || index === 0}
                  aria-label={`Move ${tabLabel(tab.tabKey)} earlier`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="button button--small"
                  onClick={() => void moveTab(tab.tabKey, 1)}
                  disabled={busy || index === ordered.length - 1}
                  aria-label={`Move ${tabLabel(tab.tabKey)} later`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="button button--small"
                  onClick={() => void setTabVisibility(tab.tabKey, !tab.visible)}
                  disabled={busy || tab.pinned}
                  title={tab.pinned ? 'The Git tab cannot be hidden' : undefined}
                >
                  {tab.visible ? 'Hide' : 'Restore'}
                </button>
              </div>
            </li>
          ))}
          {fixedTab !== undefined && (
            <li className="tab-admin__row">
              <span className="tab-admin__position">{ordered.length + 1}</span>
              <span className="tab-admin__name">
                <Icon name={tabIcon(fixedTab.tabKey)} />
                {tabLabel(fixedTab.tabKey)}
                <span className="chip chip--pinned">always last</span>
              </span>
            </li>
          )}
        </ul>

        <button type="button" className="button" onClick={() => void restoreTabs()} disabled={busy}>
          Restore default tabs
        </button>
      </section>

      {appInfo !== null && (
        <section className="card card--muted">
          <h2 className="card__title">Local storage</h2>
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
            Steward stores its own configuration and execution records only. Git and provider data are read
            from Git and the provider APIs, never treated as a local system of record.
          </p>
        </section>
      )}
    </div>
  );
}
