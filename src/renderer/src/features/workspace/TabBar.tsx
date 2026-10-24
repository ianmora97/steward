import type { TabKey, WorkspaceTab } from '@shared/schemas/tabs';
import { Icon, type IconName } from '../../components/Icon';
import { useAppStore } from '../../stores/app.store';

const TAB_LABELS: Record<TabKey, string> = {
  git: 'Git',
  terminal: 'Terminal',
  ssh: 'VPC',
  actions: 'Actions',
  deployments: 'Deployments',
  settings: 'Workspace'
};

const TAB_ICONS: Record<TabKey, IconName> = {
  git: 'git',
  terminal: 'terminal',
  ssh: 'ssh',
  actions: 'actions',
  deployments: 'deployments',
  settings: 'settings'
};

export function tabIcon(tabKey: TabKey): IconName {
  return TAB_ICONS[tabKey];
}

export function tabLabel(tabKey: TabKey): string {
  return TAB_LABELS[tabKey];
}

/**
 * Tab order and visibility are stored per project, so the bar renders whatever
 * the user arranged last — and the Git tab is seeded first for every new one.
 */
export function TabBar({ tabs }: { tabs: WorkspaceTab[] }): React.JSX.Element {
  const activeTabKey = useAppStore((state) => state.activeTabKey);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  const visible = [...tabs].filter((tab) => tab.visible).sort((a, b) => a.position - b.position);

  return (
    <div className="tabbar" role="tablist">
      {visible.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.tabKey === activeTabKey}
          className={`tabbar__tab${tab.tabKey === activeTabKey ? ' tabbar__tab--active' : ''}`}
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
