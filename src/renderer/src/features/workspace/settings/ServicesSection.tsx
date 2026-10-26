import { OPTIONAL_TAB_KEYS, PINNED_TAB_KEYS, TAB_DESCRIPTIONS, type TabKey } from '@shared/schemas/tabs';
import { Card } from '../../../components/Card';
import { Icon } from '../../../components/Icon';
import { useAppStore } from '../../../stores/app.store';
import { toast } from '../../../stores/toast.store';
import { tabIcon, tabLabel } from '../TabBar';
import { IconButton } from '../../../components/IconButton';
import { Button } from '../../../components/Button';

/**
 * Which services this project shows on its tab bar. Turning one off only takes it off the bar: its connections and
 * settings stay, and it comes back from the + menu or from here.
 */
export function ServicesSection(): React.JSX.Element {
  const tabs = useAppStore((state) => state.tabs);
  const busy = useAppStore((state) => state.busy);
  const moveService = useAppStore((state) => state.moveService);
  const setTabVisibility = useAppStore((state) => state.setTabVisibility);
  const restoreTabs = useAppStore((state) => state.restoreTabs);

  async function toggle(tabKey: TabKey, visible: boolean): Promise<void> {
    if (await setTabVisibility(tabKey, visible)) {
      toast.success(visible ? `${tabLabel(tabKey)} added to the bar` : `${tabLabel(tabKey)} removed from the bar`);
    }
  }

  const optional = [...tabs].filter((tab) => OPTIONAL_TAB_KEYS.includes(tab.tabKey)).sort((a, b) => a.position - b.position);
  const visibleOnes = optional.filter((tab) => tab.visible);

  return (
    <div className="pset__stack">
      <Card>
        <Card.Header title="On the tab bar" />
        <p className="card__hint">Git and Terminal are always there. Add the services this project actually uses.</p>

        <ul className="pset__services">
          {PINNED_TAB_KEYS.map((key: TabKey) => (
            <li key={key} className="pset__service">
              <span className="pset__service-icon">
                <Icon name={tabIcon(key)} size={18} />
              </span>
              <span className="pset__service-text">
                <span className="pset__service-name">{tabLabel(key)}</span>
                <span className="card__hint">Always on the bar</span>
              </span>
            </li>
          ))}
          {optional.map((tab) => {
            const position = visibleOnes.findIndex((candidate) => candidate.tabKey === tab.tabKey);
            return (
              <li key={tab.id} className="pset__service">
                <span className="pset__service-icon">
                  <Icon name={tabIcon(tab.tabKey)} size={18} />
                </span>
                <span className="pset__service-text">
                  <span className="pset__service-name">{tabLabel(tab.tabKey)}</span>
                  <span className="card__hint">{TAB_DESCRIPTIONS[tab.tabKey]}</span>
                </span>
                {tab.visible && (
                  <span className="pset__service-order">
                    <IconButton icon="chevronUp" label={`Move ${tabLabel(tab.tabKey)} earlier`} disabled={busy || position <= 0} onClick={() => void moveService(tab.tabKey, -1)} />
                    <IconButton icon="chevronDown" label={`Move ${tabLabel(tab.tabKey)} later`} disabled={busy || position === visibleOnes.length - 1} onClick={() => void moveService(tab.tabKey, 1)} />
                  </span>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={tab.visible}
                  aria-label={`Show ${tabLabel(tab.tabKey)} on the bar`}
                  className={`switch${tab.visible ? ' switch--on' : ''}`}
                  disabled={busy}
                  onClick={() => void toggle(tab.tabKey, !tab.visible)}
                >
                  <span className="switch__knob" />
                </button>
              </li>
            );
          })}
        </ul>

        <Button disabled={busy} onClick={() => void restoreTabs()}>
          Reset the bar
        </Button>
        <p className="card__hint">Resets to Git and Terminal only.</p>
      </Card>
    </div>
  );
}
