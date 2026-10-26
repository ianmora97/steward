import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { OPTIONAL_TAB_KEYS, PINNED_TAB_KEYS, TAB_DESCRIPTIONS, type TabKey, type WorkspaceTab } from '@shared/schemas/tabs';
import { Icon, type IconName } from '../../components/Icon';
import { useAppStore } from '../../stores/app.store';
import { toast } from '../../stores/toast.store';

const TAB_LABELS: Record<TabKey, string> = {
  git: 'Git',
  terminal: 'Terminal',
  ssh: 'VPC',
  github: 'GitHub',
  deployments: 'Deployments',
  docker: 'Docker',
  mongodb: 'MongoDB',
  redis: 'Redis',
  settings: 'Settings'
};

const TAB_ICONS: Record<TabKey, IconName> = {
  git: 'git',
  terminal: 'terminal',
  ssh: 'ssh',
  github: 'pullRequest',
  deployments: 'deployments',
  docker: 'docker',
  mongodb: 'mongodb',
  redis: 'database',
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

const MENU_WIDTH = 300;

/** The services a project has not added yet, each one click away. A portal, because the bar scrolls and would clip it. */
function AddTabMenu({ hidden, onAdd }: { hidden: TabKey[]; onAdd: (tabKey: TabKey) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const box = trigger.current?.getBoundingClientRect();
    if (box === undefined) return;
    setPosition({ left: Math.max(8, Math.min(box.left, window.innerWidth - MENU_WIDTH - 8)), top: box.bottom + 6 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Node;
      if (menu.current?.contains(target) === true || trigger.current?.contains(target) === true) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="tabbar__add"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add a service"
        title="Add a service"
        onClick={() => {
          setPosition(null);
          setOpen((value) => !value);
        }}
      >
        <Icon name="plus" size={15} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="addmenu"
            role="menu"
            aria-label="Add a service"
            style={{ left: position?.left ?? 0, top: position?.top ?? 0, width: MENU_WIDTH, visibility: position === null ? 'hidden' : 'visible' }}
          >
            {hidden.map((tabKey) => (
              <button
                key={tabKey}
                type="button"
                role="menuitem"
                className="addmenu__item"
                onClick={() => {
                  setOpen(false);
                  onAdd(tabKey);
                }}
              >
                <span className="addmenu__icon">
                  <Icon name={tabIcon(tabKey)} size={18} />
                </span>
                <span className="addmenu__text">
                  <span className="addmenu__name">{tabLabel(tabKey)}</span>
                  <span className="addmenu__hint">{TAB_DESCRIPTIONS[tabKey]}</span>
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * Git and Terminal are always there; every other service is on the bar only because the project added it. A tab
 * that is not on the bar keeps its row (and its settings) and comes back from the + menu. Settings closes the bar.
 */
export function TabBar({ tabs }: { tabs: WorkspaceTab[] }): React.JSX.Element {
  const activeTabKey = useAppStore((state) => state.activeTabKey);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setTabVisibility = useAppStore((state) => state.setTabVisibility);

  const onBar = [...tabs]
    .filter((tab) => tab.visible)
    .sort((a, b) => Number(a.tabKey === FIXED_LAST_TAB) - Number(b.tabKey === FIXED_LAST_TAB) || a.position - b.position);
  const hidden = OPTIONAL_TAB_KEYS.filter((key) => !onBar.some((tab) => tab.tabKey === key));

  async function add(tabKey: TabKey): Promise<void> {
    if (!(await setTabVisibility(tabKey, true))) return;
    setActiveTab(tabKey);
    toast.success(`${tabLabel(tabKey)} added to the bar`);
  }

  async function remove(tabKey: TabKey): Promise<void> {
    if (await setTabVisibility(tabKey, false)) toast.success(`${tabLabel(tabKey)} removed from the bar`);
  }

  const settingsIndex = onBar.findIndex((tab) => tab.tabKey === FIXED_LAST_TAB);
  const before = settingsIndex === -1 ? onBar : onBar.slice(0, settingsIndex);
  const settings = settingsIndex === -1 ? null : onBar[settingsIndex];

  const renderTab = (tab: WorkspaceTab): React.JSX.Element => {
    const active = tab.tabKey === activeTabKey;
    const removable = !PINNED_TAB_KEYS.includes(tab.tabKey) && tab.tabKey !== FIXED_LAST_TAB;
    return (
      <div key={tab.id} className={`tabbar__item${active ? ' tabbar__item--active' : ''}`}>
        <button
          type="button"
          role="tab"
          aria-selected={active}
          className={`tabbar__tab${active ? ' tabbar__tab--active' : ''}${removable ? ' tabbar__tab--removable' : ''}`}
          onClick={() => setActiveTab(tab.tabKey)}
        >
          <Icon name={tabIcon(tab.tabKey)} />
          {tabLabel(tab.tabKey)}
        </button>
        {removable && (
          <button
            type="button"
            className="tabbar__close"
            aria-label={`Remove ${tabLabel(tab.tabKey)} from the bar`}
            title={`Remove ${tabLabel(tab.tabKey)} from the bar (nothing is deleted)`}
            onClick={() => void remove(tab.tabKey)}
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="tabbar" role="tablist">
      {before.map(renderTab)}
      {hidden.length > 0 && <AddTabMenu hidden={hidden} onAdd={(tabKey) => void add(tabKey)} />}
      {settings !== null && settings !== undefined && <div className="tabbar__end">{renderTab(settings)}</div>}
    </div>
  );
}
