import type { TabKey, WorkspaceTab } from '@shared/schemas/tabs';
import { Icon, type IconName } from '../../components/Icon';
import { useAppStore } from '../../stores/app.store';

const TAB_LABELS: Record<TabKey, string> = {
  git: 'Git',
  terminal: 'Terminal',
  ssh: 'VPC',
  github: 'GitHub',
  deployments: 'Deployments',
  settings: 'Settings'
};

const TAB_ICONS: Record<TabKey, IconName> = {
  git: 'git',
  terminal: 'terminal',
  ssh: 'ssh',
  github: 'pullRequest',
  deployments: 'deployments',
  settings: 'settings'
};

export function tabIcon(tabKey: TabKey): IconName {
  return TAB_ICONS[tabKey];
}

export function tabLabel(tabKey: TabKey): string {
  return TAB_LABELS[tabKey];
}

/** Settings is not part of the arrangeable set: it always closes the bar, flush right. */
export const FIXED_LAST_TAB: TabKey = 'settings';

/**
 * Tab order and visibility are stored per project, so the bar renders whatever
 * the user arranged last — and the Git tab is seeded first for every new one.
 * Settings is the exception: wherever it is stored, it renders last.
 */
export function TabBar({ tabs }: { tabs: WorkspaceTab[] }): React.JSX.Element {
  const activeTabKey = useAppStore((state) => state.activeTabKey);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  const visible = [...tabs]
    .filter((tab) => tab.visible)
    .sort((a, b) => Number(a.tabKey === FIXED_LAST_TAB) - Number(b.tabKey === FIXED_LAST_TAB) || a.position - b.position);

  return (
    <div className="tabbar" role="tablist">
      {visible.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.tabKey === activeTabKey}
          className={`tabbar__tab${tab.tabKey === activeTabKey ? ' tabbar__tab--active' : ''}${tab.tabKey === FIXED_LAST_TAB ? ' tabbar__tab--end' : ''}`}
          onClick={() => setActiveTab(tab.tabKey)}
        >
          <Icon name={tabIcon(tab.tabKey)} />
          {tabLabel(tab.tabKey)}
          {tab.pinned && <span className="tabbar__pin" title="Always available">•</span>}
        </button>
      ))}
    </div>
  );
}
